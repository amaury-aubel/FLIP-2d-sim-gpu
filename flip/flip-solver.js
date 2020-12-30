"use strict";

import { StaggeredGrid, voxelType, getMaxSpeed } from './staggered-grid.js';

class FLIPSolver {

  gravity = 9.81;
  flipness = 0.95;
  elapsedTime = 0;
  gpu = false;

  constructor(grid) {
    // clear position and velocity
    this.positions = [];
    this.velocities = [];
    // create simulation grid
    this.grid = new StaggeredGrid(grid);
  }


  emitParticles(isInsideShape, args) {
    const origin = this.grid.lowerLeft;
    const cellSize = this.grid.cellSize;

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
              this.velocities.push(7, 1);
          }
        }
      }
    }
    return this.positions;
  }



  transferVelocitiesToGrid() {

    this.grid.transferToGrid(this.positions, this.velocities);

    // save a copy of the grid for FLIP scheme
    this.gridCopy = new StaggeredGrid(this.grid);
  }

  transferVelocitiesFromGrid() {

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
  }

  addGravity(substep) {

    const gravityForce = -this.gravity * substep;
    for (let i = 0; i < this.grid.vy.length; i++)
      for (let j = 0; j < this.grid.vy[i].length; j++)
        this.grid.vy[i][j] += gravityForce;
  }
 
  advectParticles(substep) {

    const numParticles = this.positions.length / 2;
    for (let i = 0; i < numParticles; ++i) {
      let [x,y] = this.grid.projectOnBoundary(this.positions[2*i] + this.velocities[2*i] * substep,
                                              this.positions[2*i+1] + this.velocities[2*i+1] * substep);
      this.positions[2*i] = x;
      this.positions[2*i+1] = y;
    }
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
    while (frameTime < frameDuration) {

      let substep = this.getTimeStep();
      substep = frameDuration - frameTime;            
      if (frameTime + substep > frameDuration) substep = frameDuration - frameTime;
      frameTime += substep;      
      
      this.advectParticles(substep);

      this.transferVelocitiesToGrid();
      
      this.addGravity(substep);
      
      this.grid.enforceBoundary(); // make sure we zero velocities out on edges of simulation grid
      this.grid.pressureSolve(substep);

      this.transferVelocitiesFromGrid();      
    }
  }
}

export { FLIPSolver };