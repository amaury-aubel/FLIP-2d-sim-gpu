"use strict";

import { StaggeredGrid, voxelType, getMaxSpeed } from './staggered-grid.js';
import {
  createDataTexture, createFixedDimDataTexture, createFramebuffer,
  makeBuffer, makeVertexArray, createProgram
} from './shader-utils.js';


class FLIPSolver {

  gravity = 9.81;
  flipness = 0.95;
  elapsedTime = 0;
  gpu = false;
  
  performance = {
    advect:0,
    toGrid: 0,
    gravity: 0,
    pressureSolve: 0,
    fromGrid:0,
  };

  constructor(gl, shaders, grid) {
    this.gl = gl;

    // clear position and velocity
    this.positions = [];
    this.velocities = [];
    // create simulation grid
    this.grid = new StaggeredGrid(grid);


    //  create buffer for single quad rasterization
    this.quadBuffer = makeBuffer(gl, new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]), gl.STATIC_DRAW);

    //
    // TANSFER TO GRID PROGRAM
    //    
    this.transferToGridPrg = createProgram(gl, [shaders.transferToGridVS, shaders.transferToGridFS]);
    this.transferToGridPrgLocs = {
      positionTex: gl.getUniformLocation(this.transferToGridPrg, 'u_positionTex'),
      velocityTex: gl.getUniformLocation(this.transferToGridPrg, 'u_velocityTex'),
      lowerLeft: gl.getUniformLocation(this.transferToGridPrg, 'u_lowerLeft'),
      dim: gl.getUniformLocation(this.transferToGridPrg, 'u_dim'),
      cellSize: gl.getUniformLocation(this.transferToGridPrg, 'u_cellSize'),
    };
    // we generate all the code directly in the vertex shader
    // so we do not need to generate any buffers (but we still need a bound VAO)
    this.transferToGridVA = makeVertexArray(gl, []);

    //
    // UPDATE POSITION PROGRAM
    //    
    this.updatePositionProgram = createProgram(gl, [shaders.defaultVS, shaders.updatePositionFS]);
    this.updatePositionPrgLocs = {
      position: gl.getAttribLocation(this.updatePositionProgram, 'a_position'),
      positionTex: gl.getUniformLocation(this.updatePositionProgram, 'u_positionTex'),
      velocityTex: gl.getUniformLocation(this.updatePositionProgram, 'u_velocityTex'),
      deltaTime: gl.getUniformLocation(this.updatePositionProgram, 'u_deltaTime'),
      lowerLeft: gl.getUniformLocation(this.updatePositionProgram, 'u_lowerLeft'),
      dim: gl.getUniformLocation(this.updatePositionProgram, 'u_dim'),
      cellSize: gl.getUniformLocation(this.updatePositionProgram, 'u_cellSize'),
    };
    this.updatePositionVA = makeVertexArray(gl, [[this.quadBuffer, this.updatePositionPrgLocs.position]]);

    //
    // PRESSURE SOLVE PROGRAM
    //    
    this.pressureSolvePrg = createProgram(gl, [shaders.defaultVS, shaders.pressureSolveFS]);
    this.pressureSolvePrgLocs = {
      position: gl.getAttribLocation(this.pressureSolvePrg, 'a_position'),
      divergenceTex: gl.getUniformLocation(this.pressureSolvePrg, 'u_divergenceTex'),
      matrixTex: gl.getUniformLocation(this.pressureSolvePrg, 'u_sparseMatrixTex'),
      pressureTex: gl.getUniformLocation(this.pressureSolvePrg, 'u_pressureTex'),      
    };
    this.pressureSolveVA = makeVertexArray(gl, [[this.quadBuffer, this.pressureSolvePrgLocs.position]]);

  }

  switchMode(gpu) {

    // gpu = false;
    // return;
    
    // do nothing if we're already in the desired mode
    if (this.gpu == gpu) return;
    // do nothing if there are no particles
    if (this.positions.length == 0) return;

    this.gpu = gpu;

    // switching from CPU to GPU
    // need to re-initialize all buffers
    if (gpu) this.initTextures();
    else {
      // swittching from GPU to CPU
      // need to download velocities from frame buffer
      //const velocity = this.readFrameBuffer(this.updateVelocityFB);

      // copy read pixels to velocities array
      //for (let i = 0; i < this.velocities.length; ++i) this.velocities[i] = velocity[i];
    }
  }

  readFrameBuffer(fb) {
    let gl = this.gl;

    // dimensions of destination texture
    let width = this.positionsTexDimensions[0];
    let height = this.positionsTexDimensions[1];

    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, width, height);
    let results = new Float32Array(width * height * 2);
    gl.readPixels(0, 0, width, height, gl.RG, gl.FLOAT, results);

    // unbind frame buffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return results;
  }

  emitParticles(isInsideShape, args, emissionSpeed) {
    let numParticles = this.positions.length;

    if (this.gpu && numParticles > 0) {
      // need to download velocities from frame buffer
      //const velocity = this.readFrameBuffer(this.updateVelocityFB);

      // copy read pixels to velocities array
      //for (let i = 0; i < this.velocities.length; ++i) this.velocities[i] = velocity[i];
    }

    const origin = this.grid.lowerLeft;
    const cellSize = this.grid.cellSize;
    let count = 0;

    // loop over all simulation domain (grid)
    for (let i = 0; i < this.grid.dim[0]; ++i) {
      let x = (i + 0.5) * cellSize + origin[0];
      for (let j = 0; j < this.grid.dim[1]; ++j) {
        let y = (j + 0.5) * cellSize + origin[1];

        // 4 particles per cell (would be 8 in 3D)
        let jittered_pos = [[x - 0.5 * Math.random() * cellSize, y - 0.5 * Math.random() * cellSize],
                            [x + 0.5 * Math.random() * cellSize, y - 0.5 * Math.random() * cellSize],
                            [x + 0.5 * Math.random() * cellSize, y + 0.5 * Math.random() * cellSize],
                            [x - 0.5 * Math.random() * cellSize, y + 0.5 * Math.random() * cellSize],
        ];
        // jittered_pos = [[x - 0.5 * Math.random() * cellSize, y - 0.5 * Math.random() * cellSize],                         
        // ];
        // if (count > 0) break;
        for (const [jittered_x, jittered_y] of jittered_pos) {
          
          // test whether we're inside the shape using the passed function
          if (isInsideShape(jittered_x, jittered_y, args)) {

              this.positions.push(jittered_x, jittered_y);
              this.velocities.push(emissionSpeed, 1);
              count++;
          }
        }
        
      }
    }

    // if we have injected new particles, recreate all textures
    if (this.gpu && this.positions.length != numParticles) this.initTextures();

    return this.positions;
  }

  deleteTextures() {
    // if no texture has been initialized, return    
    if (!this.positionsTex) return;

    let gl = this.gl;
    gl.deleteFramebuffer(this.updatePosition1FB);    
    gl.deleteFramebuffer(this.updatePosition0FB);
    gl.deleteFramebuffer(this.transferToGridFB);

    gl.deleteTexture(this.gridVelocitiesTex);
    gl.deleteTexture(this.velocitiesTex);
    gl.deleteTexture(this.positions1Tex);
    gl.deleteTexture(this.positions0Tex);
  }

  initTextures() {
    let gl = this.gl;
    this.deleteTextures();

    // Estimate position program
    let { tex: Tex0, dimensions: texDimensions } =
      createDataTexture(gl, this.positions, 2, gl.RG32F, gl.RG, gl.FLOAT);
    let { tex: Tex1, dimensions: dummy1 } =
      createDataTexture(gl, this.positions, 2, gl.RG32F, gl.RG, gl.FLOAT);

    // we need to create two textures to avoid a feedback loop
    // we'll cycle between these two as needed
    this.positions0Tex = Tex0;
    this.positions1Tex = Tex1;
    this.positionsTex = this.positions0Tex; // start with texture 0
    this.positionsTexDimensions = texDimensions;

    // updatePosition is the frame buffer where we write final positions
    // this creates a cycle for all the frame buffers, yeah!
    this.updatePosition1FB = createFramebuffer(gl, this.positions0Tex);
    this.updatePosition0FB = createFramebuffer(gl, this.positions1Tex);
    this.updatePositionFB = this.updatePosition0FB;

    let { tex: velocitiesTex, dimensions: velocitiesTexDimensions } =
      createDataTexture(gl, this.velocities, 2, gl.RG32F, gl.RG, gl.FLOAT);
    this.velocitiesTex = velocitiesTex;
    
    const width = this.grid.dim[0]+1;
    const height = this.grid.dim[1]+1;
    let gridVelocities =  new Float32Array(width * height * 4).fill(0);    
    this.gridVelocitiesTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.gridVelocitiesTex);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,        // mip level
        gl.RGBA32F,
        width,
        height,
        0,        // border
        gl.RGBA,
        gl.FLOAT,
        gridVelocities,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.gridVelocitiesTexDimensions =  [width, height];
    this.transferToGridFB = createFramebuffer(gl, this.gridVelocitiesTex);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  drawSingleQuad(fb) {
    let gl = this.gl;
    // dimensions of destination texture
    let width = this.positionsTexDimensions[0];
    let height = this.positionsTexDimensions[1];

    // bind to proper frame buffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, width, height);

    // drawing a clip space -1 to +1 quad = map over entire destination array
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  drawAndReadBackSingleQuad(fb) {
    let gl = this.gl;

    // dimensions of destination texture
    let width = this.positionsTexDimensions[0];
    let height = this.positionsTexDimensions[1];

    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, width, height);

    // drawing a clip space -1 to +1 quad = map over entire destination array
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    const results = new Float32Array(width * height * 2);
    gl.readPixels(0, 0, width, height, gl.RG, gl.FLOAT, results);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return results;
  }


  transferVelocitiesToGridGPU() {
    let gl = this.gl;
    let numParticles = this.positions.length / 2; // x and y coords
    console.log("GPU particles to grid");
    gl.useProgram(this.transferToGridPrg);
    gl.bindVertexArray(this.transferToGridVA);

    // bind texture to texture units 0 and 1
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.positionsTex);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, this.velocitiesTex);

    // tell the shader to look at the textures on texture units 0 and 1
    gl.uniform1i(this.transferToGridPrgLocs.positionTex, 0);
    gl.uniform1i(this.transferToGridPrgLocs.velocityTex, 1);

    // dimensions of destination texture
    const width = this.gridVelocitiesTexDimensions[0];
    const height = this.gridVelocitiesTexDimensions[1];
    
    // set other uniforms      
    gl.uniform1f(this.transferToGridPrgLocs.cellSize, this.grid.cellSize);
    gl.uniform2f(this.transferToGridPrgLocs.lowerLeft, this.grid.lowerLeft[0], this.grid.lowerLeft[1]);
    gl.uniform2f(this.transferToGridPrgLocs.dim, width, height);


    // bind to proper frame buffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.transferToGridFB);
    gl.viewport(0, 0, width, height);

    // set up blending so we can accumulate per pixel
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    
    // draw each particle 9 times
    gl.drawArrays(gl.POINTS, 0, numParticles*9);

    gl.disable(gl.BLEND);

    const results = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, results);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return results;
  }

  transferVelocitiesToGrid() {
    let start = performance.now();

    this.grid.transferToGrid(this.positions, this.velocities);    
    
    // save a copy of the grid for FLIP scheme
    this.gridCopy = new StaggeredGrid(this.grid);

    let stop = performance.now();
    this.performance.toGrid += stop-start;
  }

  transferVelocitiesFromGrid() {
    let start = performance.now();

    // absolute velocties (PIC scheme)
    const picVel = this.grid.transferFromGrid(this.positions);

    // relative velocities (FLIP scheme)    
    for (let i = 0; i < this.grid.vx.length; i++)
      this.gridCopy.vx[i].forEach((element,j,array) => {
        array[j] = this.grid.vx[i][j] - element;
      });      

    for (let i = 0; i < this.grid.vy.length; i++)
      this.gridCopy.vy[i].forEach((element,j,array) => {
        array[j] = this.grid.vy[i][j] - element;
      });

    const flipVel = this.gridCopy.transferFromGrid(this.positions);    
    
    // lerp between PIC and FLIP
    for (let i = 0; i < this.velocities.length; ++i) {
       this.velocities[i] = this.flipness * (this.velocities[i] + flipVel[i]) +
                            (1 - this.flipness) * picVel[i];
    }    
    let stop = performance.now();
    this.performance.fromGrid += stop-start;
  }

  addGravity(substep) {
    let start = performance.now();

    const gravityForce = -this.gravity * substep;
    for (let i = 0; i < this.grid.vy.length; i++)
      for (let j = 0; j < this.grid.vy[i].length; j++)
          this.grid.vy[i][j] += gravityForce;
  
    let stop = performance.now();
    this.performance.gravity += stop-start;
  }
 
  advectParticlesGPU(substep, readResults) {
    let gl = this.gl;
    //console.log("GPU particle advection");
    gl.useProgram(this.updatePositionProgram);
    gl.bindVertexArray(this.updatePositionVA);// just a quad        

    // bind texture to texture units 0 and 1
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.positionsTex);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, this.velocitiesTex);

    // tell the shader to look at the textures on texture units 0 and 1
    gl.uniform1i(this.updatePositionPrgLocs.positionTex, 0);
    gl.uniform1i(this.updatePositionPrgLocs.velocityTex, 1);
    // set other uniforms  
    gl.uniform1f(this.updatePositionPrgLocs.deltaTime, substep);
    gl.uniform1f(this.updatePositionPrgLocs.cellSize, this.grid.cellSize);
    gl.uniform2f(this.updatePositionPrgLocs.lowerLeft, this.grid.lowerLeft[0], this.grid.lowerLeft[1]);
    gl.uniform2f(this.updatePositionPrgLocs.dim, this.grid.dim[0], this.grid.dim[1]);    

    if (readResults) {
      return this.drawAndReadBackSingleQuad(this.updatePositionFB);
    }
    else this.drawSingleQuad(this.updatePositionFB);
  }

  advectParticles(substep) {
    let start = performance.now();
    const numParticles = this.positions.length / 2;
    for (let i = 0; i < numParticles; ++i) {
      let [x,y] = this.grid.projectOnBoundary(this.positions[2*i] + this.velocities[2*i] * substep,
                                              this.positions[2*i+1] + this.velocities[2*i+1] * substep);
      this.positions[2*i] = x;
      this.positions[2*i+1] = y;
    }
    let stop = performance.now();
    this.performance.advect += stop-start;
  }


  getTimeStep() {
    let maxVel = Math.max(getMaxSpeed(this.grid.vx), getMaxSpeed(this.grid.vy));
    //console.log(maxVel);
    return maxVel > 0 ? 3*this.grid.cellSize/maxVel : 1;
  }
  
  
  advanceFrame(frameDuration) {
    
    const numParticles = this.positions.length / 2;
    if (numParticles == 0) return;


    let frameTime = 0;
    let new_p = this.positions.splice(); // deep copy
    while (frameTime < frameDuration) {

      let substep = this.getTimeStep();
      substep = frameDuration - frameTime;            
      if (frameTime + substep > frameDuration) substep = frameDuration - frameTime;
      frameTime += substep;      

      if (this.gpu) {
        let start = performance.now();

        this.initTextures();
        const results = this.advectParticlesGPU(substep,true);
        for (let i=0; i<this.positions.length; ++i) this.positions[i] = results[i];

        let stop = performance.now();
        this.performance.advect += stop-start;
      }
      else this.advectParticles(substep);

      if (false && this.gpu) {
        const results = this.transferVelocitiesToGridGPU();
        
        
        let tmpVelX = new Array(this.grid.dim[0]+1);
        let tmpVelY = new Array(this.grid.dim[0]+1);
        // +1 as velocities are stored on faces of the grid in the y direction    
        for (let i = 0; i < tmpVelY.length; ++i) {
          tmpVelX[i] = new Array(this.grid.dim[1] + 1);
          tmpVelX[i].fill(0);
          tmpVelY[i] = new Array(this.grid.dim[1] + 1);
          tmpVelY[i].fill(0);
        }
  
        for (let i=0; i<results.length/4; ++i) {          
          const wx = results[i*4+2];
          const wy = results[i*4+3];
          const x = Math.floor(i % (this.grid.dim[0]+1));
          const y = Math.floor(i / (this.grid.dim[0]+1));
          if (wx > 1e-8) tmpVelX[x][y] = results[i*4+0]/wx;
          if (wy > 1e-8) tmpVelY[x][y] = results[i*4+1]/wy;
        }
        // console.log("tmpVelY");
        // console.log(tmpVelY);
        // console.log("grid");        
        this.transferVelocitiesToGrid(); 
        
        // overwrite velocities
        for (let i = 0; i <= this.grid.dim[0]; ++i) {
          for (let j = 0; j <= this.grid.dim[1]; ++j) { 
              // copy final velocity into grid
              if (j < this.grid.dim[1]) this.grid.vx[i][j] = tmpVelX[i][j];
              if (i < this.grid.dim[0]) this.grid.vy[i][j] = tmpVelY[i][j];
          }
        }
//        console.log(this.grid.vy);
        this.gridCopy = new StaggeredGrid(this.grid);        
      }
      else this.transferVelocitiesToGrid();
      
      this.addGravity(substep);
      
      this.grid.enforceBoundary(); // make sure we zero velocities out on edges of simulation grid
      let start = performance.now();
      if (this.gpu) {
        this.pressureSolveGPU(substep);

        //this.grid.pressureSolve(substep);
      }
      else this.grid.pressureSolve(substep);
      let stop = performance.now();
      this.performance.pressureSolve += stop-start;

      this.transferVelocitiesFromGrid();      

    }
  }

  pressureSolveGPU(dt) {    
    let gl = this.gl;

    const nx = this.grid.dim[0];
    const ny = this.grid.dim[1];
    const numCells = nx * ny;

    // init solver variables
    let divergence = new Float32Array(numCells);
    divergence.fill(0);
    
    // create final pressure texture 
    // it has same dimensions as divergence
    // we need to create two textures to avoid a feedback loop
    // we'll cycle between these two as needed      
    let pressure0Tex = createFixedDimDataTexture(gl, divergence, nx, ny, gl.R32F, gl.RED, gl.FLOAT);
    let pressure1Tex = createFixedDimDataTexture(gl, divergence, nx, ny, gl.R32F, gl.RED, gl.FLOAT);

    for (let j = 0; j < ny; ++j) {
      for (let i = 0; i < nx; ++i) {
                
        if (this.grid.cells[i][j] == voxelType.FLUID) {
          const row = i + nx * j;
          divergence[row] = (this.grid.vx[i][j] - this.grid.vx[i+1][j]) + (this.grid.vy[i][j] - this.grid.vy[i][j+1]);
        }
      }
    }
    // recreate divergence Texture at each frame 
    // as it needs to be reinitialized with proper data    
    let divergenceTex = createFixedDimDataTexture(gl, divergence, nx, ny, gl.R32F, gl.RED, gl.FLOAT);    

    // create sparse matrix
    // five entries per row: diagonal element, row - nx, row - 1, row + 1, row + nx
    let matrix = new Float32Array(5 * numCells);
    matrix.fill(0);
    const scale = dt / this.grid.cellSize;
    for (let j = 0; j < ny; ++j) {
      for (let i = 0; i < nx; ++i) {
        const row = i + nx * j;
        
        if (this.grid.cells[i][j] != voxelType.FLUID) continue;

        let cellType = [voxelType.SOLID, voxelType.SOLID, voxelType.SOLID, voxelType.SOLID];
        if (i+1 < nx) cellType[2] = this.grid.cells[i + 1][j];
        if (i-1 >= 0) cellType[1] = this.grid.cells[i - 1][j];
        if (j+1 < ny) cellType[3] = this.grid.cells[i][j + 1];
        if (j-1 >= 0) cellType[0] = this.grid.cells[i][j - 1];

        const idxInRow = [
          row - nx,
          row - 1,
          row + 1,          
          row + nx,          
        ];

        // fill in sparse matrix
        for (let cell = 0; cell < 4; ++cell) {
          
          if (cellType[cell] == voxelType.SOLID) continue;
          
          // if air or fluid
          matrix[5*row] += scale;  // cell element (diagonal)

          if (cellType[cell] == voxelType.FLUID) {
            matrix[5*row + 1 + cell] = -scale; // neighboring cells
          }
        }
      }
    }
      // create sparseMatrixTexture    
    let sparseMatrixTex = createFixedDimDataTexture(gl, matrix, nx, ny*5, gl.R32F, gl.RED, gl.FLOAT);

  
    // the frame buffer where we write pressure    
    let pressure1FB = createFramebuffer(gl, pressure0Tex);
    let pressure0FB = createFramebuffer(gl, pressure1Tex);
    

    gl.useProgram(this.pressureSolvePrg);
    gl.bindVertexArray(this.pressureSolveVA);

    // bind texture to texture units 0,1,2
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, divergenceTex);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, sparseMatrixTex);
    gl.activeTexture(gl.TEXTURE0 + 2);
    gl.bindTexture(gl.TEXTURE_2D, pressure0Tex);

    // tell the shader to look at the textures on texture units 0-2
    gl.uniform1i(this.pressureSolvePrgLocs.divergenceTex, 0);
    gl.uniform1i(this.pressureSolvePrgLocs.matrixTex, 1);
    gl.uniform1i(this.pressureSolvePrgLocs.pressureTex, 2);
    
    for (let iter=0; iter<200; iter++) {

      gl.activeTexture(gl.TEXTURE0 + 2);
      gl.bindTexture(gl.TEXTURE_2D, pressure0Tex);
  
      // bind to proper frame buffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, pressure0FB);
      gl.viewport(0, 0, nx, ny);      
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.activeTexture(gl.TEXTURE0 + 2);
      gl.bindTexture(gl.TEXTURE_2D, pressure1Tex);

      // bind to proper frame buffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, pressure1FB);
      gl.viewport(0, 0, nx, ny);      
      gl.drawArrays(gl.TRIANGLES, 0, 6);      
    }
    const results = new Float32Array(numCells);
    gl.readPixels(0, 0, nx, ny, gl.RED, gl.FLOAT, results);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // adjust velocity field to make it divergence free
    this.grid.removeDivergence(results, scale);

    // clean up
    if (sparseMatrixTex) gl.deleteTexture(sparseMatrixTex);
    if (pressure0Tex) gl.deleteTexture(pressure0Tex);
    if (pressure1Tex) gl.deleteTexture(pressure1Tex);
    if (divergenceTex) gl.deleteTexture(divergenceTex);
  }
}

export { FLIPSolver };
