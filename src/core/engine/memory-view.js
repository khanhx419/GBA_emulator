import { inherit } from './util.js';

function MemoryView(memory, offset) {
	inherit.call(this);
	this.buffer = memory;
	this.view = MemoryView.DataView(this.buffer, typeof(offset) === "number" ? offset : 0);
	this.mask = memory.byteLength - 1;
	this.resetMask();
}

MemoryView.DataView = function (buffer, byteOffset, byteLength) {
	if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(buffer)) {
		return new DataView(buffer.buffer, buffer.byteOffset + (byteOffset || 0), byteLength);
	} else if (buffer instanceof ArrayBuffer) {
		return new DataView(buffer, byteOffset, byteLength);
	} else if (buffer && buffer.buffer instanceof ArrayBuffer) {
		return new DataView(buffer.buffer, (buffer.byteOffset || 0) + (byteOffset || 0), byteLength);
	} else {
		return new DataView(buffer, byteOffset, byteLength);
	}
};

MemoryView.prototype.resetMask = function() {
	this.mask8 = this.mask & 0xFFFFFFFF;
	this.mask16 = this.mask & 0xFFFFFFFE;
	this.mask32 = this.mask & 0xFFFFFFFC;
};

MemoryView.prototype.load8 = function(offset) {
	return this.view.getInt8(offset & this.mask8);
};

MemoryView.prototype.load16 = function(offset) {
	return this.view.getInt16(offset & this.mask16, true);
};

MemoryView.prototype.loadU8 = function(offset) {
	return this.view.getUint8(offset & this.mask8);
};

MemoryView.prototype.loadU16 = function(offset) {
	return this.view.getUint16(offset & this.mask16, true);
};

MemoryView.prototype.load32 = function(offset) {
	return this.view.getInt32(offset & this.mask32, true);
};

MemoryView.prototype.store8 = function(offset, value) {
	this.view.setInt8(offset & this.mask8, value);
};

MemoryView.prototype.store16 = function(offset, value) {
	this.view.setInt16(offset & this.mask16, value, true);
};

MemoryView.prototype.store32 = function(offset, value) {
	this.view.setInt32(offset & this.mask32, value, true);
};

MemoryView.prototype.invalidatePage = function(address) {};

MemoryView.prototype.replaceData = function(memory, offset) {
	this.buffer = memory;
	this.view = MemoryView.DataView(this.buffer, typeof(offset) === "number" ? offset : 0);
	if (this.icache) {
		this.icache = new Array(this.icache.length);
	}
};

export default MemoryView;
