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
  }

  emitParticles(isInsideShape, args, emissionSpeed) {
    let numParticles = this.positions.length;

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

    return this.positions;
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

      this.advectParticles(substep);

      this.transferVelocitiesToGrid();
      
      this.addGravity(substep);
      
      this.grid.enforceBoundary(); // make sure we zero velocities out on edges of simulation grid

      let start = performance.now();
      if (this.gpu) this.pressureSolveGPU(substep);      
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
    const results = this.jacobiGPU(matrix, nx, ny, 300, pressure0Tex, pressure1Tex, divergenceTex);

    // adjust velocity field to make it divergence free
    this.grid.removeDivergence(results, scale);
  }

  jacobiGPU(matrix, nx, ny, numIter, pressure0Tex, pressure1Tex, divergenceTex) {
    let gl = this.gl;
    const numCells = nx * ny;

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
    
    for (let iter=0; iter<numIter/2; iter++) {

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

    // clean up
    if (sparseMatrixTex) gl.deleteTexture(sparseMatrixTex);
    if (pressure0Tex) gl.deleteTexture(pressure0Tex);
    if (pressure1Tex) gl.deleteTexture(pressure1Tex);
    if (divergenceTex) gl.deleteTexture(divergenceTex);
    
    return results;
  }
}

export { FLIPSolver };
