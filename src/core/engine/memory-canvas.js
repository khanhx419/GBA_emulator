function MemoryCanvas() {
}

MemoryCanvas.prototype.getContext = function () {
  return this;
};

MemoryCanvas.prototype.createImageData = function (w, h) {
  var pixelData = {
    // RGBA
    width: w,
    height: h,
    data: new Uint8Array(w * h * 4),
  };
  this.pixelData = pixelData;
  return pixelData;
};

MemoryCanvas.prototype.putImageData = function (pixelData, x, y) {
  this.pixelData = pixelData;
};

export default MemoryCanvas;
