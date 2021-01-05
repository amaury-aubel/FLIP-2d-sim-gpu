"use strict";


function dotProduct(x, y) {
  let sum = 0;
  for (let i = 0; i < x.length; ++i) sum += x[i] * y[i];
  return sum;
}

function maxAbs(x) {
  let maxVal = 0;
  for (let i = 0; i < x.length; ++i) {
    const absVal = Math.abs(x[i]);
    if (absVal > maxVal) maxVal = absVal;
  }
  return maxVal;
}

function addScaled(alpha, x, y) {
  for (let i = 0; i < x.length; ++i) y[i] += alpha * x[i];
}

// Basically taken from Robert Bridson book on fluid simulation (aka fluid bible)
class PCGSolver {
  _toleranceFactor = 1e-6;
  _maxIterations = 400;

  /* Status of last solve */
  _lastIterationCount = 0;
  _lastResidual = 0;

  epsilon = 1e-12;

  constructor() {
  }

  solve(matrix, rhs, result) {
    //console.log("Running conjugate gradient")
    let rows = matrix.size;
    if (rows == 0) return false;

    // Solver temporary variables
    let z = [];
    let s = [];
    let r = [];
    s.length = rows; 
    z.length = rows; z.fill(0);
    r.length = rows;
    

    for (let i=0; i<rhs.length; i++) r[i] = rhs[i];

    // set initial guess vector zero
    result.fill(0);
    
    this._lastIterationCount = 0;

    this._lastResidual = maxAbs(r);
    if (this._lastResidual < this.epsilon) return true;

    let precond = this.formPreconditioner(matrix);
    this.applyPreconditioner(precond, r, z);
    let rho = dotProduct(z, r);
    if (rho < this.epsilon || rho != rho) return false;
    
    for (let i=0; i<z.length; i++) s[i] = z[i];

    /* must prepare compact data for Matrix * Vector operation */
    matrix.compressData();

    let tolerance = this._toleranceFactor * this._lastResidual;     
    for (let iter=0; iter < this._maxIterations; ++iter) {
      matrix.multiply(s, z);
      const alpha = rho / dotProduct(s, z);
      addScaled(alpha, s, result);
      addScaled(-alpha, z, r);
      this._lastResidual = maxAbs(r);
      if (this._lastResidual < tolerance) {
        this._lastIterationCount = iter + 1;
        return true;
      }
      this.applyPreconditioner(precond, r, z);
      const rho_new = dotProduct(z, r);
      const beta = rho_new / rho;
      addScaled(beta, s, z);
      for (let i=0; i<z.length; i++) s[i] = z[i];
      
      rho = rho_new;
    }

    /* Failed to converge */
    this._lastIterationCount = this._maxIterations;
    return false;
  }


  formPreconditioner(matrix) {
    const s_modification_parameter = 0.97;

    const size = matrix.size;

    /* Preconditioner - triangular matrix */
    let precond = {};
    precond.rows = size;
    /* inverse of diagonal elements */
    precond.invdiag = [];
    precond.invdiag.length = size;
    precond.invdiag.fill(0);/* important: must set zero */;
    /* values below the diagonal, listed column by column */
    precond.colValues = []
    /* a list of all row indices, for each column in turn */
    precond.colIndices = [];
    /* where each column begins in rowindex (plus an extra entry at the
       end, of #nonzeros) */
    precond.colStartIdx = [];
    precond.colStartIdx.length = size + 1;

    /* Copy data from the matrix */
    for (let i = 0; i < size; ++i) {

      precond.colStartIdx[i] = precond.colIndices.length;
      const indices = matrix.rowIndices[i];
      const values = matrix.rowValues[i];
      for (let j = 0; j < indices.length; j++) {
        if (indices[j] > i) {
          precond.colIndices.push(indices[j]);
          precond.colValues.push(values[j]);
        } else if (indices[j] == i) {
          precond.invdiag[i] = values[j];
        }
      }
    }
    precond.colStartIdx[size] = precond.colIndices.length;

    for (let k = 0; k < size; ++k) {
      let invdiag = precond.invdiag[k];
      if (invdiag == 0) {
        continue; /* null row/column */
      }
      invdiag = 1.0 / Math.sqrt(invdiag);
      precond.invdiag[k] = invdiag;

      const pStart = precond.colStartIdx[k];
      const pEnd = precond.colStartIdx[k + 1];
      for (let p = pStart; p < pEnd; p++) {
        precond.colValues[p] *= invdiag;
      }

      /* Process the lower elements of column k */
      for (let p = pStart; p < pEnd; ++p) {

        const j = precond.colIndices[p];
        const multiplier = precond.colValues[p];
        let missing = 0;
        let a = pStart;

        let b = 0;

        while (a < pEnd && precond.colIndices[a] < j) {
          while (b < matrix.rowIndices[j].length) {
            if (matrix.rowIndices[j][b] < precond.colIndices[a]) ++b;
            else if (matrix.rowIndices[j][b] == precond.colIndices[a]) {
              break;
            }
            else {
              missing += precond.colValues[a];
              break;
            }
          }
          ++a;
        }

        invdiag = precond.invdiag[j];
        if (a < pEnd && precond.colIndices[a] == j) {
          invdiag -= multiplier * precond.colValues[a];
        }
        ++a;

        b = precond.colStartIdx[j];
        const jEnd = precond.colStartIdx[j + 1];
        while (a < pEnd && b < jEnd) {
          if (precond.colIndices[b] < precond.colIndices[a]) ++b;
          else if (precond.colIndices[b] == precond.colIndices[a]) {
            precond.colValues[b] -= multiplier * precond.colValues[a];
            ++a;
            ++b;
          }
          else {
            missing += precond.colValues[a++];
          }
        }

        while (a < pEnd) {
          missing += precond.colValues[a++];
        }

        precond.invdiag[j] = invdiag - s_modification_parameter * multiplier * missing;
      }
    }
    return precond;
  }

  applyPreconditioner(precond, rhs, result) {
    const rows = precond.rows;

    /* Solve L * result = rhs */
    for (let i = 0; i < rows; ++i) result[i] = rhs[i];
    
    for (let i = 0; i < rows; ++i) {
      const colStart = precond.colStartIdx[i];
      const colEnd = precond.colStartIdx[i + 1];
      const tmp = result[i] * precond.invdiag[i];
      result[i] = tmp;
      for (let j = colStart; j < colEnd; j++) {
        result[precond.colIndices[j]] -= precond.colValues[j] * tmp;
      }
    }

    /* solve L^T * result = result */
    let i = rows;
    do {
      --i;
      const colStart = precond.colStartIdx[i];
      const colEnd = precond.colStartIdx[i + 1];
      let tmp = result[i];
      for (let j = colStart; j < colEnd; j++) {
        tmp -= precond.colValues[j] * result[precond.colIndices[j]];
      }
      tmp *= precond.invdiag[i];
      result[i] = tmp;
    } while (i != 0);
  }
};

export { PCGSolver };

