"use strict";

import { SparseMatrix } from './sparse-matrix.js';
import { PCGSolver } from './pcg-solver.js';


function maxAbs(x) {
  let maxVal = 0;
  for (let i = 0; i < x.length; ++i) {
    const absVal = Math.abs(x[i]);
    if (absVal > maxVal) maxVal = absVal;
  }
  return maxVal;
}

const voxelType = {
  SOLID: 1,
  FLUID: 2,
  AIR: 3,
}

class StaggeredGrid {

  constructor(grid) {
    this.dim = grid.dim;
    this.cellSize = grid.cellSize;
    this.lowerLeft = grid.lowerLeft;
    this.upperRight = grid.upperRight;

    // copy constructor
    if (grid instanceof StaggeredGrid) {

      // deep clone the 2d arrays
      this.vx = grid.vx.map((value) => [...value]);
      this.vy = grid.vy.map((value) => [...value]);
      this.cells = grid.cells.map((value) => [...value]);
    }
    else {

      // +1 as velocities are stored on faces of the grid in the x direction
      this.vx = new Array(grid.dim[0] + 1);
      for (let i = 0; i < this.vx.length; ++i) {
        this.vx[i] = new Array(grid.dim[1]);
        this.vx[i].fill(0);
      }

      this.vy = new Array(grid.dim[0]);
      // +1 as velocities are stored on faces of the grid in the y direction    
      for (let j = 0; j < this.vy.length; ++j) {
        this.vy[j] = new Array(grid.dim[1] + 1);
        this.vy[j].fill(0);
      }

      // deep clone the 2d arrays
      this.weightX = this.vx.map((value) => [...value]);
      this.weightY = this.vy.map((value) => [...value]);

      // mark cells as AIR
      this.cells = new Array(grid.dim[0]);
      for (let i = 0; i < this.cells.length; ++i) {
        this.cells[i] = new Array(grid.dim[1]);
        this.cells[i].fill(voxelType.AIR);
      }
    }
  }

  worldToGrid(worldX, worldY) {
    return [(worldX - this.lowerLeft[0]) / this.cellSize,
    (worldY - this.lowerLeft[1]) / this.cellSize];
  }

  worldToGridCell(worldX, worldY) {
    return [Math.floor((worldX - this.lowerLeft[0]) / this.cellSize),
    Math.floor((worldY - this.lowerLeft[1]) / this.cellSize)];
  }

  gridToWorld(x, y) {
    return [x * this.cellSize + this.lowerLeft[0],
    y * this.cellSize + this.lowerLeft[1]];
  }

  isValidIdx(x, y) {
    return x >= 0 && x < this.dim[0] && y >= 0 && y < this.dim[1];
  }

  kernel(x, y) {

    return Math.max(0, 1 - Math.abs(x)) * Math.max(0, 1 - Math.abs(y));
  }
 

  transferToGrid(positions, velocities) {

    for (let i = 0; i <= this.dim[0]; ++i) {
      for (let j = 0; j < this.dim[1]; ++j) {        
        this.weightX[i][j] = 0;
        this.vx[i][j] = 0;        
      }
    }
    for (let i = 0; i < this.dim[0]; ++i) {
      for (let j = 0; j <= this.dim[1]; ++j) {
        this.weightY[i][j] = 0;
        this.vy[i][j] = 0;
      }
    }

    for (let i = 0; i < this.dim[0]; ++i) {
      for (let j = 0; j < this.dim[1]; ++j) this.cells[i][j] = voxelType.AIR;      
    }
    
    // loop over particles
    const numParticles = positions.length/2;
    for (let p=0; p<numParticles; ++p) {

      let [i, j] = this.worldToGridCell(positions[2*p], positions[2*p+1]);      
      this.cells[i][j] = voxelType.FLUID;

      let [x, y] = this.worldToGrid(positions[2*p], positions[2*p+1]);

      // velocity x
      for (let v=-1; v<=1; ++v) {
        const jj = j+v;
        if (jj < 0 || jj>= this.dim[1]) continue;
        
        for (let u=0; u<=1; ++u) { 
          const ii = i+u;
          let wx = this.kernel(x - ii, y - jj - 0.5);
          this.weightX[ii][jj] += wx;
          this.vx[ii][jj] += wx * velocities[2*p];
        }
      }

      // velocity y
      for (let u=-1; u<=1; ++u) {
        const ii = i+u;
        if (ii < 0 || ii>=this.dim[0]) continue;
        
        for (let v=0; v<=1; ++v) { 
          const jj = j+v;
          let wy = this.kernel(x - ii - 0.5, y - jj);
          this.weightY[ii][jj] += wy;
          this.vy[ii][jj] += wy * velocities[2*p+1];
        }
      }
    }
    // normalize
    for (let i = 0; i <= this.dim[0]; ++i) {
      for (let j = 0; j < this.dim[1]; ++j) {
        if (this.weightX[i][j] < 1e-10) continue;
        this.vx[i][j] /= this.weightX[i][j];
      }
    }
    for (let i = 0; i < this.dim[0]; ++i) {
      for (let j = 0; j <= this.dim[1]; ++j) {
        if (this.weightY[i][j] < 1e-10) continue;
        this.vy[i][j] /= this.weightY[i][j];
      }
    }
  }

  removeDivergence(pressure, scale) {
    const nx = this.dim[0];

    // loop over all simulation domain (grid)
    for (let i = 0; i <= this.dim[0]; ++i) {
      for (let j = 0; j < this.dim[1]; ++j) {

        // Edges of the domain
        if (i == 0 || i == this.dim[0]) {
          this.vx[i][j] = 0;
          continue;
        }

        if (this.cells[i][j] == voxelType.FLUID || this.cells[i-1][j] == voxelType.FLUID) {          
          const row = i + j * nx;
          const pressureDiff = pressure[row] - pressure[row - 1];
          this.vx[i][j] -= pressureDiff * scale;
        }
      }
    }

    for (let i = 0; i < this.dim[0]; ++i) {
      for (let j = 0; j <= this.dim[1]; ++j) {

        // Edges of the domain
        if (j == 0 || j == this.dim[1]) {
          this.vy[i][j] = 0;
          continue;
        }

        if (this.cells[i][j] == voxelType.FLUID || this.cells[i][j - 1] == voxelType.FLUID) {          
          const row = i + j * nx;
          const pressureDiff = pressure[row] - pressure[row - nx];
          this.vy[i][j] -= pressureDiff * scale;
        }
      }
    }
  }

  pressureSolve(dt) {
    const nx = this.dim[0];
    const ny = this.dim[1];
    const numCells = nx * ny;

    let pcgSolver = new PCGSolver();

    // init solver variables
    let matrix = new SparseMatrix(numCells);
    let rhs = [];
    let solution = [];
    rhs.length = numCells;
    solution.length = numCells;    
    solution.fill(0);

    const scale = dt / this.cellSize;
    for (let j = 0; j < ny; ++j) {
      for (let i = 0; i < nx; ++i) {
        const row = i + nx * j;
        
        if (this.cells[i][j] != voxelType.FLUID) {
          rhs[row] = 0;
          continue;
        }

        let cellType = [voxelType.SOLID, voxelType.SOLID, voxelType.SOLID, voxelType.SOLID];
        if (i+1 < nx) cellType[0] = this.cells[i + 1][j];
        if (i-1 >= 0) cellType[1] = this.cells[i - 1][j];
        if (j+1 < ny) cellType[2] = this.cells[i][j + 1];
        if (j-1 >= 0) cellType[3] = this.cells[i][j - 1];

        const idxInRow = [
          row + 1,
          row - 1,
          row + nx,
          row - nx
        ];

        // fill in sparse matrix
        for (let cell = 0; cell < 4; ++cell) {
          
          if (cellType[cell] == voxelType.SOLID) continue;
          
          // if air or fluid
          matrix.addToElement(row, row, scale);  // cell element (diagonal)

          if (cellType[cell] == voxelType.FLUID) {
            matrix.addToElement(row, idxInRow[cell], -scale); // neighboring cells
          }
        }
        // write right-hand side of linear system
        // that's equal to the divergence discretized on the mac grid
        rhs[row] = (this.vx[i][j] - this.vx[i+1][j]) + (this.vy[i][j] - this.vy[i][j+1]);
      }
    }

    // call preconditioned conjugate gradient (Bridson's code)
    // to solve linear system
    if (!pcgSolver.solve(matrix, rhs, solution)) {
      console.log("Conjugate Gradient failed!");
    }

    // adjust velocity field to make it divergence free
    this.removeDivergence(solution, scale);
  }

  enforceBoundary() {

    // left border of simulation grid
    for (let j = 0; j < this.dim[1]; ++j) this.vx[0][j] = 0;//Math.max(0, this.vx[0][j]);
    // right border of simulation grid
    for (let j = 0; j < this.dim[1]; ++j) this.vx[this.dim[0]][j] = 0;//Math.min(0, this.vx[this.dim[0]][j]);
    // bottom border of simulation grid
    for (let i = 0; i < this.dim[0]; ++i) this.vy[i][0] = 0;//Math.max(0, this.vy[i][0]);
    // top border of simulation grid
    for (let i = 0; i < this.dim[0]; ++i) this.vy[i][this.dim[1]] = Math.min(0, this.vy[i][this.dim[1]]);
  }


  bilinearInterpVelX(x, y) {
    const i = Math.floor(x);
    let j = Math.floor(y);
    if (y - j < 0.5) j--;

    const a = x - i;
    // case where we're at the top or the bottom of the grid
    if (j + 1 == this.dim[1] || j < 0) {
      j = Math.max(0, j);
      return (1 - a) * this.vx[i][j] + a * this.vx[i + 1][j];
    };
    const b = 1 - a;
    const c = y - j;
    const d = 1 - c;

    return d * (b * this.vx[i][j] + a * this.vx[i + 1][j]) + c * (b * this.vx[i][j + 1] + a * this.vx[i + 1][j + 1]);
  }

  bilinearInterpVelY(x, y) {
    let i = Math.floor(x);
    const j = Math.floor(y);
    if (x - i < 0.5) i--;

    const c = y - j;
    // case where we're at the right or left end of the grid
    if (i + 1 == this.dim[0] || i < 0) {
      i = Math.max(0, i);
      return (1 - c) * this.vy[i][j] + c * this.vy[i][j + 1];
    };
    const a = x - i;
    const b = 1 - a;
    const d = 1 - c;

    return d * (b * this.vy[i][j] + a * this.vy[i + 1][j]) + c * (b * this.vy[i][j + 1] + a * this.vy[i + 1][j + 1]);
  }

  // Transfer velocities from grid
  transferFromGrid(positions) {
    let velocities = [];
    for (let i = 0; i < positions.length / 2; ++i) {

      let [x, y] = this.worldToGrid(positions[2 * i], positions[2 * i + 1]);      
      velocities.push(this.bilinearInterpVelX(x, y), this.bilinearInterpVelY(x, y));
    }
    return velocities;
  }

  projectOnBoundary(worldX, worldY) {

    let [x, y] = this.worldToGrid(worldX, worldY);
    const epsilon = 1e-6;
    x = Math.max(epsilon, x);
    y = Math.max(epsilon, y);
    x = Math.min(x, this.dim[0] - epsilon);
    y = Math.min(y, this.dim[1] - epsilon);
    return this.gridToWorld(x, y);
  }


  getCells() {
    let positions = [];
    let colors = [];
    const cellSize = this.cellSize;
    const halfCell = 0.5 * cellSize;

    let xpos = this.lowerLeft[0] + halfCell;
    for (let i = 0; i < this.dim[0]; ++i, xpos += cellSize) {

      let ypos = this.lowerLeft[1] + halfCell;
      for (let j = 0; j < this.dim[1]; ++j, ypos += cellSize) {

        positions.push(xpos, ypos);
        const [x, y] = this.worldToGrid(xpos, ypos);
        let vel_x = this.bilinearInterpVelX(x, y);
        let vel_y = this.bilinearInterpVelY(x, y);

        colors.push(Math.abs(vel_x) * 1.5, 0.25, Math.abs(vel_y) * 1.5);
      }
    }
    return { positions, colors };
  }
}

function getMaxSpeed(v) {
  let maxVel = 0;
  for (let i = 0; i < v.length; i++)
    for (let j = 0; j < v[i].length; j++)
      maxVel = Math.max(Math.abs(v[i][j]), maxVel);
  return maxVel;
}

export { StaggeredGrid, voxelType, getMaxSpeed };
