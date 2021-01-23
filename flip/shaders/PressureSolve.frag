#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D u_divergenceTex;
uniform sampler2D u_sparseMatrixTex;
uniform sampler2D u_pressureTex;


out vec4 outColor;

float getMatrixSample(ivec2 dimensions, int index) {
  int y = index / dimensions.x;
  int x = index % dimensions.x;
  return texelFetch(u_sparseMatrixTex, ivec2(x, y), 0).x;
}

 
void main() {
  
  // compute texel coord from gl_FragCoord;
  ivec2 texelCoord = ivec2(gl_FragCoord.xy);

  ivec2 dimensions = textureSize(u_divergenceTex, 0);  // size of mip 0  
  int nx = dimensions.x;
  int ny = dimensions.y;
  int row = texelCoord.x + nx*texelCoord.y;

  // sparse matrix is stored per row
  // five entries per row: diagonal element, row - nx, row - 1, row + 1, row + nx

  float diagonal = getMatrixSample(dimensions, row*5);
  if(diagonal == 0.0) discard;
  
  float sum = getMatrixSample(dimensions,row*5+1) * texelFetch(u_pressureTex, ivec2(texelCoord.x, texelCoord.y-1), 0).x;
  sum +=  getMatrixSample(dimensions,row*5+2) * texelFetch(u_pressureTex, ivec2(texelCoord.x-1, texelCoord.y), 0).x;
  sum +=  getMatrixSample(dimensions,row*5+3) * texelFetch(u_pressureTex, ivec2(texelCoord.x+1, texelCoord.y), 0).x;
  sum +=  getMatrixSample(dimensions,row*5+4) * texelFetch(u_pressureTex, ivec2(texelCoord.x, texelCoord.y+1), 0).x;
  sum -= texelFetch(u_divergenceTex, texelCoord, 0).x;
  
  //outColor = vec4(0.1,0.1,0.1,0.1);
  outColor = vec4(-sum/diagonal, 0.0, 0.0, 1.0);  
}