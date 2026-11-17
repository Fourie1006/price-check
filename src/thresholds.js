'use strict';
// Score needed to call a picture the same product ("exact") or a similar one.
// clip = the downloaded AI model (not tuned on real shop photos yet, so treat as a starting point).
// basic = simple colour and shape comparison (rough, used when the model is not available).
module.exports = {
  clip: { exact: 0.88, similar: 0.78 },
  basic: { exact: 0.6, similar: 0.48 },
};
