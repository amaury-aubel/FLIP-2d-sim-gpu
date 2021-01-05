"use strict";

import { parseTxt, parseOBJ } from './shader-utils.js';
import { Boundary } from './boundary.js';
import { FLIPSolver } from './flip-solver.js';
import { Boat } from './boat.js';

// simulation grid
const grid = {
  lowerLeft: [-40, -20],     // lower left corner of simulation
  upperRight: [40, 20],     // upper rigt corner of simulation
  cellSize: 1,                  // size of 1 grid cell
};
grid.min = grid.lowerLeft;   // for convenience
grid.max = grid.upperRight;  // for convenience
grid.dim = [(grid.max[0] - grid.min[0]) / grid.cellSize, // resolution in x and y
(grid.max[1] - grid.min[1]) / grid.cellSize];

async function main() {

  // Get A WebGL context  
  const canvas = document.querySelector("#canvas");
  const gl = canvas.getContext("webgl2", { antialias: true });
  if (!gl) {
    alert("Your browser does not support WebGL 2");
    return;
  }
  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) {
    alert("Your browser does not support EXT_color_buffer_float");
  }

  // look up the divcontainer
  const loadContainerElement = document.querySelector("#load");

  // load FLIP text shape that's stored in an "OBJ"-like .txt format
  let response = await fetch("resources/flip.txt");
  let text = await response.text();
  let fontShape = parseTxt(text);

  // load boat that's stored in an OBJ format as well as hull
  response = await fetch("resources/boat.obj");
  text = await response.text();
  let boatObj = parseOBJ(text);
  response = await fetch("resources/boat_hull.txt");
  text = await response.text();
  let boatHull = parseTxt(text);  

  // Load all shaders from separate files
  response = await fetch('shaders/ParticleSphereShader2D.vert');
  let vs = await response.text();
  response = await fetch('shaders/ParticleSphereShader2D.frag');
  let fs = await response.text();

  response = await fetch('shaders/grid.vert');
  let gridVS = await response.text();
  response = await fetch('shaders/grid.frag');
  let gridFS = await response.text();

  response = await fetch("shaders/default.vert");
  let defaultVS = await response.text();
  response = await fetch('shaders/Boundary.vert');
  let boundaryVS = await response.text();
  response = await fetch('shaders/Boundary.frag');
  let boundaryFS = await response.text();

  response = await fetch('shaders/Boat.vert');
  let boatVS = await response.text();
  response = await fetch('shaders/Boat.frag');
  let boatFS = await response.text();

  response = await fetch('shaders/PositionUpdate.frag');
  let updatePositionFS = await response.text();

  response = await fetch('shaders/TransferToGrid.vert');
  let transferToGridVS = await response.text();
  response = await fetch('shaders/TransferToGrid.frag');
  let transferToGridFS = await response.text();

  const shaders = {
    defaultVS,
    boundaryVS,
    boundaryFS,
    boatVS,
    boatFS,
    updatePositionFS,
    transferToGridVS,
    transferToGridFS,
  };

  let boat = new Boat(gl, shaders, grid, boatObj, boatHull);

  // program to render particles as disks
  let program = webglUtils.createProgramFromSources(gl, [vs, fs]);
  let positionAttributeLoc = gl.getAttribLocation(program, "a_position");
  let velocityAttributeLoc = gl.getAttribLocation(program, "a_velocity");
  let resolutionLoc = gl.getUniformLocation(program, "u_resolution");
  let particleRadiusLoc = gl.getUniformLocation(program, "u_particleRadius");

  // program to display the grid
  let gridPrg = webglUtils.createProgramFromSources(gl, [gridVS, gridFS]);
  let gridPrgLocs = {
    position: gl.getAttribLocation(gridPrg, 'a_position'),
    color: gl.getAttribLocation(gridPrg, 'a_color'),
    resolution: gl.getUniformLocation(gridPrg, 'u_resolution'),
    cellSize: gl.getUniformLocation(gridPrg, 'u_cellSize'),
  };

  // create FLIP solver
  let flip = new FLIPSolver(gl, shaders, grid);
  let positions = flip.emitParticles((x, y, data) => m3.distance(x, y, data.pos[0], data.pos[1]) < data.radius,
    { pos: [0, 0], radius: 15 }, 0);

  //  
  // PARTICLES
  //

  // Create a buffer and put points in it
  let positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  // vertex array object
  let vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(positionAttributeLoc);
  gl.vertexAttribPointer(positionAttributeLoc, 2, gl.FLOAT, false, 0, 0);


  let velocityBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, velocityBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(flip.velocities), gl.STATIC_DRAW);
  gl.bindVertexArray(vao);

  gl.enableVertexAttribArray(velocityAttributeLoc);
  gl.vertexAttribPointer(velocityAttributeLoc, 2, gl.FLOAT, false, 0, 0);

  //  
  // GRID
  //

  let gridData = flip.grid.getCells();
  let gridBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gridData.positions), gl.STATIC_DRAW);

  let gridVao = gl.createVertexArray();
  gl.bindVertexArray(gridVao);
  gl.enableVertexAttribArray(gridPrgLocs.position);
  gl.vertexAttribPointer(gridPrgLocs.position, 2, gl.FLOAT, false, 0, 0);

  // Create a color buffer and put colors in it
  let colorBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gridData.colors), gl.STATIC_DRAW);
  gl.bindVertexArray(gridVao);
  gl.enableVertexAttribArray(gridPrgLocs.color);
  gl.vertexAttribPointer(gridPrgLocs.color, 3, gl.FLOAT, false, 0, 0);


  let boundary = new Boundary(gl, shaders, grid);

  // UI parameters defaults
  let parametersUI = {
    fluidity: 0.95,
    emissionSpeed: 10,
    grid: false,
    GPU: false,
    preset: 0,
    resolution: 0,
    boat: false,
  };

  let params = [
    { type: "slider", key: "fluidity", change: updateUI, min: 0.85, max: 0.98, precision: 2, step: 0.01, uiPrecision: 2 },
    { type: "slider", key: "emissionSpeed", change: updateUI, min: -10, max: 10, precision: 1, step: 0.1, uiPrecision: 1 },
    { type: "checkbox", key: "boat", change: updateUI },    
    { type: "checkbox", key: "grid", change: updateUI },
    { type: "option", key: "resolution", change: updateUI, options: ["low", "high"] },
    { type: "option", key: "preset", change: applyPreset, options: ["none", "dam break", "dual dam", "font"] },
  ];
  // only include GPU if webGL extension available
  if (ext) params.push({ type: "checkbox", key: "GPU", change: updateUI });  
  let widgets = webglLessonsUI.setupUI(document.querySelector("#ui"), parametersUI, params);

  // simulation variables
  const speed = 2.0;              // in increments of 1/60 seconds
  let elapsedTime = 0;
  let gpu = parametersUI.GPU;
  let resolution = parametersUI.resolution;
  let frameCounter = 0;
  let displayBoat = parametersUI.boat;

  updateUI();

  // hide message that says "loading..."
  loadContainerElement.hidden = true

  // handle mouse clicks
  gl.canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    emitParticles(e);
  });

  // handle keyboard
  window.addEventListener('keydown', (e) => {
    if (e.key == "r") {
      e.preventDefault();
      resolution = (parametersUI.resolution == 0) ? 1 : 0; // force a reset of the sim
      updateUI();
    }
  });


  // pass pointer to function to draw scene
  requestAnimationFrame(drawScene);

  // draw the scene
  function drawScene(curTime) {

    // advance simulation
    if (elapsedTime > 0.5) {// && frameCounter<2) {
      if (displayBoat) boat.updatePositionAndOrient(flip);
      flip.switchMode(gpu);
      flip.elapsedTime = elapsedTime;
      flip.advanceFrame(speed / 60.0);
      frameCounter++;

      if (frameCounter % 1000 == 0) {
        for (const [key, value] of Object.entries(flip.performance)) {
          let val = value/frameCounter;
          console.log(`${key}: ${val}`);        
        }
      }
    }
    elapsedTime += 1 / 60.0;


    // draw on the whole canvas
    webglUtils.resizeCanvasToDisplaySize(gl.canvas);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Clear the canvas
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // render grid
    if (parametersUI.grid) {
      gridData = flip.grid.getCells();

      gl.useProgram(gridPrg);
      gl.bindVertexArray(gridVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gridData.positions), gl.STATIC_DRAW);
      gl.bindVertexArray(gridVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gridData.colors), gl.STATIC_DRAW);
      // uniforms
      gl.uniform1f(gridPrgLocs.resolution, grid.max[0] * 1.02);
      gl.uniform1f(gridPrgLocs.cellSize, gl.canvas.width / (2.5 * grid.dim[0]));
      gl.drawArrays(gl.POINTS, 0, gridData.positions.length);
    }
    
    if (displayBoat) boat.draw(gl, grid.max[0] * 1.02);

    // render particles
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(flip.positions), gl.STATIC_DRAW);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, velocityBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(flip.velocities), gl.STATIC_DRAW);

    let numParticles = flip.positions.length / 2; // x and y coords
    // uniforms
    gl.uniform1f(resolutionLoc, grid.max[0] * 1.02);
    gl.uniform1f(particleRadiusLoc, gl.canvas.width / (2.0 * grid.dim[0]));
    gl.drawArrays(gl.POINTS, 0, numParticles);

    
    boundary.draw(gl, grid.max[0], [1, 1, 1, 1]);

    // Call drawScene again next frame
    requestAnimationFrame(drawScene);
  }

  function emitParticles(e) {
    const rect = canvas.getBoundingClientRect();

    // normalized coordinates [0..1]
    let pos = [(e.clientX - rect.left) / (rect.right - rect.left),
    (e.clientY - rect.bottom) / (rect.top - rect.bottom)];

    // device coordinates [-1..1]
    pos = [2 * (pos[0] - 0.5), 2 * (pos[1] - 0.5)];

    // simuation coordinates
    pos = [grid.max[0] * pos[0], grid.max[1] * pos[1]];
    flip.emitParticles((x, y, data) => m3.distance(x, y, data.pos[0], data.pos[1]) < data.radius,
      { pos, radius: 10 }, parametersUI.emissionSpeed);
  }

  function applyPreset() {
    switch (parametersUI.preset) {
      case 0: return;
      case 1: //'dam break",        
      case 2: //"dual dam break",       
      case 3: //"font"      
        resolution = (parametersUI.resolution == 0) ? 1 : 0; // force a reset of the sim
        break;
      default: return;
    }
    updateUI();
  }

  function updateUI() {

    // handle change of res first
    if (resolution != parametersUI.resolution) {
      // reset simulator
      frameCounter = 0;
      elapsedTime = 0;
      resolution = parametersUI.resolution;
      switch (resolution) {
        case 0:
          grid.cellSize = 1.0;
          break;
        case 1:
          grid.cellSize = 0.5;
          break;
      }
      grid.dim = [(grid.max[0] - grid.min[0]) / grid.cellSize, // resolution in x and y
      (grid.max[1] - grid.min[1]) / grid.cellSize];

      boundary = new Boundary(gl, shaders, grid);
      flip = new FLIPSolver(gl, shaders, grid);
      boat = new Boat(gl, shaders, grid, boatObj, boatHull);

      if (parametersUI.preset == 0) {
        flip.emitParticles((x, y, data) => m3.distance(x, y, data.pos[0], data.pos[1]) < data.radius,
          { pos: [0, 0], radius: 15 }, 0);
      }
      else if (parametersUI.preset == 1 || parametersUI.preset == 2) {
        flip.emitParticles((x, y, data) => Math.abs(x - data.pos[0]) < data.width && Math.abs(y - data.pos[1]) < data.height,
          { pos: [-20-5*Math.random(), 0], width: 9+5*Math.random(), height: 18 }, 0.0);

        if (parametersUI.preset == 2) {
          flip.emitParticles((x, y, data) => Math.abs(x - data.pos[0]) < data.width && Math.abs(y - data.pos[1]) < data.height,
            { pos: [20+5*Math.random(), 0], width: 9+5*Math.random(), height: 18 }, 0.0);
        }
      }
      else {
        function isInShape(x, y, data) {
          let shape = data.shape;
          let scale = data.scale;

          // shamelessly taken from stack overflow
          // (nice use of the determinant I must say)
          //
          // returns true iff the line from (a,b)->(c,d) intersects with (p,q)->(r,s)
          function intersects(a, b, c, d, p, q, r, s) {
            let det, gamma, lambda;
            det = (c - a) * (s - q) - (r - p) * (d - b);
            if (det === 0) return false;
            else {
              lambda = ((s - q) * (r - a) + (p - r) * (s - b)) / det;
              gamma = ((b - d) * (r - a) + (c - a) * (s - b)) / det;
              return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
            }
          };
          let numIntersection = 0;
          // loop over all prims
          for (const prim of shape.prims) {
            // loop over all segments in this prim
            for (let i = 0; i < prim.length - 1; ++i) {
              // retrieve two end points of segment
              let p0 = shape.positions[prim[i]];
              let p1 = shape.positions[prim[i + 1]];
              let p = p0[0] * scale;
              let q = p0[1] * scale;
              let r = p1[0] * scale;
              let s = p1[1] * scale;
              if (intersects(x, y, x, y + grid.max[0] * 5, p, q, r, s)) numIntersection++;
            }
          }
          let modulo = numIntersection % 2;
          return data.invert ? modulo == 0 : modulo == 1;
        }

        positions = flip.emitParticles(isInShape, {
          shape: fontShape, scale: grid.max[0] * 2,
          invert: false
        }, 0);
      }
    }
    
    if (displayBoat != parametersUI.boat) {
      if (parametersUI.boat) boat = new Boat(gl, shaders, grid, boatObj, boatHull);
      displayBoat = parametersUI.boat;
    }

    if (gpu != parametersUI.GPU) {
      alert("GPU acceleration not implemented yet")
    }
    gpu = ext && parametersUI.GPU;
    flip.flipness = parametersUI.fluidity;
  }
}

main();
