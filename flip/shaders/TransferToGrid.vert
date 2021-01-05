#version 300 es

precision highp float;
precision highp sampler2D;
precision highp int;


uniform sampler2D u_positionTex;
uniform sampler2D u_velocityTex;
uniform vec2 u_lowerLeft;   // lower left point of simulation grid
uniform vec2 u_dim;         // dimensions of grid
uniform float u_cellSize;   // width/height of one grid cell


out vec2 v_position;
out vec2 v_velocity;

vec2 getTextureSample(sampler2D tex, ivec2 dimensions, int index) {
  int y = index / dimensions.x;
  int x = index % dimensions.x;
  return texelFetch(tex, ivec2(x, y), 0).xy;
}

void main() {
  
  gl_PointSize = 2.0;

  ivec2 posTexDimensions = textureSize(u_positionTex, 0);  // size of mip 0
  int particleIdx = gl_VertexID / 9;

  // retrieve velocity and pass it to fragment shader  
  v_velocity = getTextureSample(u_velocityTex, posTexDimensions, particleIdx);

  // retrieve position, transform to grid coordinates and pass to fragment shader
  vec2 position = getTextureSample(u_positionTex, posTexDimensions, particleIdx);
  v_position = (position - u_lowerLeft) / u_cellSize;

  // each particle is rendered 9 times
  // as it can distribute its velocity to 9 adjacent cells in 2D
  int idx = gl_VertexID % 9;
  int x = idx / 3;
  int y = idx % 3;

  // The offsets to get to an adjcent cell are -1,0,1 in both X and Y
  // So we do some modulo operations on 'idx' to figure out a 2d offset
  vec2 offset = vec2(float(x-1), float(y-1));
  vec2 cellIdx = floor(v_position + offset);

  // it's possible at this stage that cellIdx is not contained within the boundaries
  // of the simulation. Clipping will take care of that situation.

  // convert the position to [-1..1]
  vec2 pos = cellIdx / u_dim;
  gl_Position = vec4(pos*2.0 - 1.0, 0.0, 1.0);
  //gl_Position = vec4(0, 0, 0.0, 1.0);
}