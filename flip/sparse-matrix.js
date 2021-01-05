class SparseMatrix {

  constructor(size) {
    this.size = size;

    // sparse matrix data
    this.rowIndices = [];
    this.rowValues = [];

    // compact data
    this.compactValues = [];
    this.compactIndices = [];
    this.rowStartIdx = [];

    // set size
    this.rowIndices.length = size;
    this.rowValues.length = size;
    this.rowStartIdx.length = size + 1;

    for (let i=0; i<this.rowIndices.length; i++) this.rowIndices[i] = [];
    for (let i=0; i<this.rowValues.length; i++) this.rowValues[i] = [];
  }


  // i, j: integers
  addToElement(i, j, val) {
      
      let k = this.rowIndices[i].indexOf(j);
      if (k >= 0) this.rowValues[i][k] += val;       
      else {
        // locate where to insert 
        for (k=0; k<this.rowIndices[i].length; k++) {
          if (this.rowIndices[i][k] > j) break;
        }
        if (k == this.rowIndices[i].length) { 
          this.rowIndices[i].push(j);
          this.rowValues[i].push(val);
        }
        else {
          // insert at index 'k'
          this.rowIndices[i].splice(k,0,j);
          this.rowValues[i].splice(k,0,val);
        }
      }      
  }

  compressData() {
    this.rowStartIdx[0] = 0;
    for (let i = 0; i < this.size; ++i) {
      this.rowStartIdx[i + 1] = this.rowStartIdx[i] + this.rowIndices[i].length;
    }

    this.compactIndices = this.rowIndices.flat();
    this.compactValues = this.rowValues.flat();
  }

  multiply(x, result) {

    for (let i = 0; i < this.size; ++i) { 
      let tmp = 0;
      for (let j = this.rowStartIdx[i]; j < this.rowStartIdx[i + 1]; ++j) {
        tmp += this.compactValues[j] * x[this.compactIndices[j]];
      }
      result[i] = tmp;
    }    
  }
}

export { SparseMatrix };