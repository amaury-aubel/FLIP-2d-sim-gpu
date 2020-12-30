"use strict";

import { parseOBJ } from './shader-utils.js';
import { Boundary } from './boundary.js';
import { FLIPSolver } from './flip-solver.js';

// simulation grid
const grid  = {
  lowerLeft : [-40,-20],     // lower left corner of simulation
  upperRight : [40, 20],     // upper rigt corner of simulation
  cellSize : 1,                  // size of 1 grid cell
};
grid.min = grid.lowerLeft;   // for convenience
grid.max = grid.upperRight;  // for convenience
grid.dim = [(grid.max[0]-grid.min[0]) / grid.cellSize, // resolution in x and y
            (grid.max[1]-grid.min[1]) / grid.cellSize];

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

  // UI parameters defaults
  let parametersUI = {    
    fluidity: 0.95,    
    GPU: ext ? true : false,
    preset: 0,
  };

  // simulation variables
  const speed = 2.0;              // in increments of 1/60 seconds
  let elapsedTime = 0;
  let gpu = ext ? true : false;   // use GPU acceleration

  // Load all shaders from separate files
  //let response = await fetch('shaders/ParticleSphereShader2D.vert');
  let response = await fetch('shaders/grid.vert');
  let vs = await response.text();
  //response = await fetch('shaders/ParticleSphereShader2D.frag');
  response = await fetch('shaders/grid.frag');
  let fs = await response.text();
  response = await fetch("shaders/default.vert");
  let defaultVS = await response.text();
  response = await fetch('shaders/Boundary.vert');
  let boundaryVS = await response.text();
  response = await fetch('shaders/Boundary.frag');
  let boundaryFS = await response.text();

  const shaders = {
    defaultVS,
    boundaryVS,
    boundaryFS,
  };

  // Use utils to compile the shaders and link into a program
  let program = webglUtils.createProgramFromSources(gl, [vs, fs]);

  // look up where the vertex data needs to go.
  let positionAttributeLoc = gl.getAttribLocation(program, "a_position");
  let resolutionLoc = gl.getUniformLocation(program, "u_resolution");
  let numParticlesLoc = gl.getUniformLocation(program, "u_numParticles");
  let particleRadiusLoc = gl.getUniformLocation(program, "u_particleRadius");
  let colorAttributeLoc = gl.getAttribLocation(program, "a_color");

  // create FLIP solver
  let flip = new FLIPSolver(grid);
  let positions = flip.emitParticles( (x, y, data) => m3.distance(x, y, data.pos[0], data.pos[1]) < data.radius,
                                       {pos: [0, 0], radius: 15});


  // Create a buffer and put points in it
  let positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  // Create a vertex array object (attribute state)
  let vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  // Turn on the attribute
  gl.enableVertexAttribArray(positionAttributeLoc);
  

  // Tell the attribute how to get data out of positionBuffer (ARRAY_BUFFER)
  let size = 2;          // 2 components per iteration
  let type = gl.FLOAT;   // the data is 32bit floats
  let normalize = false; // don't normalize the data
  let stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
  let offset = 0;        // start at the beginning of the buffer
  gl.vertexAttribPointer(
    positionAttributeLoc, size, type, normalize, stride, offset);

  // Create a colro buffer and put colors in it
  let colorBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  let colors = [];
  for (let i=0; i<positions.length/2; i++) colors.push(1,1,1);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);

  // Turn on the attribute
  gl.enableVertexAttribArray(colorAttributeLoc);
  
  // Tell the attribute how to get data out of colorBuffer (ARRAY_BUFFER)
  size = 3;          // 3 components per iteration
  gl.vertexAttribPointer(colorAttributeLoc, size, type, normalize, stride, offset);


  // hide message that says "loading..."
  loadContainerElement.hidden = true    
  let boundary = new Boundary(gl, shaders, grid);

  let params = [
    { type: "slider", key: "fluidity", change: updateUI, min: 0.8, max: 1, precision: 2, step: 0.01, uiPrecision: 2 },
  ];
  // only include GPU if webGL extension available
  if (ext) params.push({ type: "checkbox", key: "GPU", change: updateUI });
  params.push({ type: "option", key: "preset", change: applyPreset, options: ["none", "washer", "splashy", "sticky", "font", "inverse"] });
  let widgets = webglLessonsUI.setupUI(document.querySelector("#ui"), parametersUI, params);
  updateUI();

  let frameCounter = 0;

  // handle mouse clicks
  gl.canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    emitParticles(e);
  });

  // handle keyboard
  window.addEventListener('keydown', (e) => {
    if (e.key == "r") {
      e.preventDefault();
      applyPreset();
    }
    else if (e.key == "n") {
      e.preventDefault();
      counter--;
    }

  });

  
  // pass pointer to function to draw scene
  requestAnimationFrame(drawScene);

  // draw the scene
  function drawScene(curTime) {

    // advance simulation
    if (elapsedTime > 0.5) {
      flip.elapsedTime = elapsedTime;
      flip.advanceFrame(speed / 60.0);
      frameCounter++;
    }
    elapsedTime += 1 / 60.0;
    

    // draw on the whole canvas
    webglUtils.resizeCanvasToDisplaySize(gl.canvas);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Clear the canvas
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Tell it to use our program (pair of shaders)
    gl.useProgram(program);

    // Bind the attribute/buffer set we want.
    gl.bindVertexArray(vao);

    // Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = positionBuffer)
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(flip.positions), gl.STATIC_DRAW);
    let numParticles = flip.positions.length / 2; // x and y coords
    //if (elapsedTime > 2 && elapsedTime<2.1) console.log(Math.min(...flip.positions));

    let data = flip.grid.getCells();
    numParticles += data.positions.length / 2; // x and y coords

    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...data.positions, ...positions]), gl.STATIC_DRAW);


    // Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = positionBuffer)
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    colors = [];
    for (let i=0; i<flip.positions.length / 2; i++) colors.push(1,0,1);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...data.colors, ...colors]), gl.STATIC_DRAW);
    // gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.colors), gl.STATIC_DRAW);


    // uniforms
    gl.uniform1f(resolutionLoc, grid.max[0]*1.02);
    gl.uniform1i(numParticlesLoc, numParticles);
    gl.uniform1f(particleRadiusLoc, gl.canvas.width / (3.0 * grid.dim[0]));
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
    flip.emitParticles( (x, y, data) => m3.distance(x, y, data.pos[0], data.pos[1]) < data.radius,
                        {pos, radius: 10} );              
  }

  function applyPreset() {

    updateUI();
  }

  function updateUI() {
    gpu = ext && parametersUI.GPU;
    flip.flipness = parametersUI.fluidity; 
  }
}

main();
