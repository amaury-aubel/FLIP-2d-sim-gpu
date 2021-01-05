#version 300 es

precision highp float;
precision highp sampler2D;

uniform sampler2D u_positionTex;
uniform sampler2D u_velocityTex;
uniform float u_deltaTime;
uniform vec2 u_lowerLeft;   // lower left point of simulation grid
uniform vec2 u_dim;         // dimensions of grid
uniform float u_cellSize;   // width/height of one grid cell


out vec4 outColor;
 
void main() {
  // compute texel coord from gl_FragCoord;
  ivec2 texelCoord = ivec2(gl_FragCoord.xy);
  vec2 position = texelFetch(u_positionTex, texelCoord, 0).xy;
  vec2 velocity = texelFetch(u_velocityTex, texelCoord, 0).xy;

  // advect particle with a simple Euler step
  vec2 newPosition = position-u_lowerLeft + velocity * u_deltaTime;

  // project particle onto boundaries of simulation grid  
  vec2 gridPosition = max(newPosition/u_cellSize, 1e-5);
  vec2 limit = u_dim - vec2(1e-5f, 1e-5f);
  gridPosition = min(gridPosition, limit);  
  newPosition = gridPosition*u_cellSize + u_lowerLeft;

  outColor = vec4(newPosition, 0, 1);
}