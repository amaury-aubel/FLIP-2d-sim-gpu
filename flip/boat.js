"use strict";

import { voxelType } from "./staggered-grid.js";

class Boat {

  // position, velocity and scale
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  scale = 1;
  prevOrients = [0,0,0,0,0,0,0,0,0,0,
                 0,0,0,0,0,0,0,0,0,0,  
                 0,0,0,0,0,0,0,0,0,0,
                ]; // 30 frames
  

  constructor(gl, shaders, grid, boatObj, boatHull) {
    this.gl = gl;
    this.grid = grid;
    this.hull = boatHull;
    
    this.program = webglUtils.createProgramFromSources(gl, [shaders.boatVS, shaders.boatFS]);

    this.prgLocs = {
      position: gl.getAttribLocation(this.program, 'a_position'),
      color: gl.getUniformLocation(this.program, 'u_color'),
      resolution: gl.getUniformLocation(this.program, 'u_resolution'),
      orient: gl.getUniformLocation(this.program, 'u_orient'),
      center: gl.getUniformLocation(this.program, 'u_center'),
    };

    this.initPosition();

    this.prepareGeometryToRender(boatObj);
  }

  worldToGrid(worldX, worldY) {
    return [(worldX - this.grid.lowerLeft[0]) / this.grid.cellSize,
    (worldY - this.grid.lowerLeft[1]) / this.grid.cellSize];
  }
  worldToGridCell(worldX, worldY) {
    return [Math.floor((worldX - this.grid.lowerLeft[0]) / this.grid.cellSize),
    Math.floor((worldY - this.grid.lowerLeft[1]) / this.grid.cellSize)];
  }
  isValidIdx(x, y) {
    return x >= 0 && x < this.grid.dim[0] && y >= 0 && y < this.grid.dim[1];
  }

  // return true if all points of the convex hull are contained 
  // within the simulation grid for the given worldX/worldY center of mass
  isContained(worldX, worldY) {
    return this.hull.positions.every(([px, py]) => {
      let x = px * this.scale + worldX;
      let y = py * this.scale + worldY;
      const [gridX, gridY] = this.worldToGrid(x, y);
      return this.isValidIdx(gridX, gridY);
    });
  }

  initPosition() {
    // pick random scale
    this.scale = Math.random() * 0.3 + 0.7;
    this.scale *= this.grid.max[0] * 0.3;

    // pick random x position to start
    let [x, y] = [0, 0];
    do x = (Math.random() - 0.5) * 2 * this.grid.max[0];
    while (this.isContained(x, y) == false);
    this.x = x;
    this.y = y;
  }

  prepareGeometryToRender(obj) {
    let gl = this.gl;

    // get 2d position arrays
    const position = obj.geometries.map(({ data }) => {
      let position = [];
      const pos = data.position;
      for (let i = 0; i < pos.length / 3; ++i) position.push(pos[3 * i], pos[3 * i + 1]);
      return position;
    });

    // get 2d colors associated with each part
    const color = obj.geometries.map(({ data }) => [data.color[0], data.color[1], data.color[2]]);
    // randomize color of hull
    const hullColors = [[1, 1, 1], [167 / 255, 176 / 255, 167 / 255], [242 / 255, 203 / 255, 164 / 255],
    [.4, .4, .35], [13 / 255, 118 / 255, 135 / 255],];
    color[1] = hullColors[Math.floor(Math.random() * hullColors.length)];

    // iterate over each part
    this.parts = [];
    for (let i = 0; i < position.length; ++i) {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(position[i]), gl.STATIC_DRAW);

      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.enableVertexAttribArray(this.prgLocs.position);
      gl.vertexAttribPointer(this.prgLocs.position, 2, gl.FLOAT, false, 0, 0);

      this.parts.push({ buffer, vao, color: color[i], num: position[i].length / 2 });
    }
  }

  updatePositionAndOrient(flip) {

    // convert positions of convex hull vertices to simulation coordinates
    let positions = [];
    let positive = [];
    let numPos = 0;
    for (let k = 0; k < this.hull.positions.length; k++) {
      let [x, y] = this.hull.positions[k];
      if (y > 0) continue; // vertices that belong to the boat's hull are all negative in Y by default
      
      positive.push(x >= 0);
      if (x >= 0) numPos++;

      x = x * this.scale + this.x;
      y = y * this.scale + this.y;
      [x, y] = flip.grid.projectOnBoundary(x, y);
      positions.push(x, y);
    }

    // rough buoyancy scheme
    // for each point of the boat's hull, we add a downward or upward motion based
    // on how many fluid cells above / air cells beneath are present in the column it lies within
    // bias downward displacement by a factor > 1 to "fake gravity"
    const numSamplePoints = positions.length / 2;
    const buoyancy = 0.05;
    let posBuoyancy = 0;
    let negBuoyancy = 0;
    for (let k = 0; k < numSamplePoints; k++) {

      let [i, j] = this.worldToGridCell(positions[2 * k], positions[2 * k + 1]);      
      let j_up = j;
      while (this.isValidIdx(i, j_up) && flip.grid.cells[i][j_up] == voxelType.FLUID) {
        if (positive[k]) posBuoyancy += buoyancy;
        else negBuoyancy += buoyancy;
        j_up++;
      }
      while (this.isValidIdx(i, j) && flip.grid.cells[i][j] == voxelType.AIR) {
        if (positive[k]) posBuoyancy -= 2*buoyancy;
        else negBuoyancy -= 3*buoyancy;        
        j--;
      }
    }
    // normalize all buyoancies
    let cumulBuoyancy = posBuoyancy + negBuoyancy;    
    cumulBuoyancy /= numSamplePoints;
    posBuoyancy /= numPos;
    negBuoyancy /= (numSamplePoints-numPos);

    // sample velocity from grid
    const gridVel = flip.grid.transferFromGrid(positions);
    let [velX, velY] = [0, 0];
    for (let k = 0; k < numSamplePoints; k++) {
      velX += gridVel[2 * k];
      velY += gridVel[2 * k + 1];
    }
    // magic coefficients
    velX *= 0.035/numSamplePoints;
    velY *= 0.035/numSamplePoints;
    velY += cumulBuoyancy*0.2;

    // lerp with previous velocity a little bit
    let filter = 0.2;
    velX = filter*this.vx + (1-filter)*velX;
    velY = filter*this.vy + (1-filter)*velY;

    // clamp displacement to half a grid cell
    const halfCell = 0.5*this.grid.cellSize;
    if (Math.abs(velX) > halfCell) velX *= halfCell/Math.abs(velX);
    if (Math.abs(velY) > halfCell) velY *= halfCell/Math.abs(velY);

    // finally advect position
    let newX = this.x + velX;
    let newY = this.y + velY;

    // enforce boundary counditions
    if (this.isContained(this.x, newY)) {
      this.y = newY;
      this.vy = velY;
    }
    if (this.isContained(newX, this.y)) {
      this.x = newX;
      this.vx = velX;
    }
    

    // orientation is filtered temporally using the last 30 frames (0.5 second)
    let newOrient = Math.pow( Math.abs(posBuoyancy-negBuoyancy)*0.9, 1.15);
    if (negBuoyancy > posBuoyancy) newOrient = -newOrient;
    this.prevOrients.push(newOrient);
    this.prevOrients.shift();
    
    let weight = 1;
    let sumWeight = 0;
    this.orient = 0;
    for (let k=this.prevOrients.length-1; k >= 0; k--) {
      this.orient += this.prevOrients[k] * weight;
      sumWeight += weight;
      weight *= 0.95;
    }
    this.orient /= sumWeight;
  }

  draw(gl, resolution) {

    gl.useProgram(this.program);

    // update shared uniforms    
    gl.uniform1f(this.prgLocs.resolution, resolution / this.scale);
    gl.uniform2f(this.prgLocs.center, this.x / this.scale, this.y / this.scale);
    gl.uniform1f(this.prgLocs.orient, this.orient);

    for (const { buffer, vao, color, num } of this.parts) {
      // set the attributes for this part.
      gl.bindVertexArray(vao);
      gl.uniform3f(this.prgLocs.color, color[0], color[1], color[2]);

      // draw triangles
      gl.drawArrays(gl.TRIANGLES, 0, num);
    }
  }
}

export { Boat };