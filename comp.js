var self = this;
self.t1 = new Date();
self.fs = require("fs");
self.cluster = require("cluster");
self.util = require("util");
self.NBPROCESSES = require("os").cpus().length;
self.sliceSize = 400000;
self.fileName = process.argv[3];
self.mode = process.argv[2];
if (self.mode === "compress"){
	self.getBlankArray = function(){
		var a = []; for (var i=0;i<256;i++){a[i] = {"ind" : i, "nb" : 0};} return a;
	};
	var library = require(__dirname + "/compress.js");
}else if (self.mode === "decompress"){
	self.getBlankArray = function(){
		var a = []; for (var i=0;i<64;i++){a[i] = [];} return a;
	};
	var library = require(__dirname + "/decompress.js");
}
global.con = function(variable){
	self.util.puts(self.util.inspect(variable));
};
String.prototype.repeat = function(nb){
	return new Array(nb+1).join(this);
};
String.prototype.lpad = function(padString, length) {
	return padString.repeat(length - this.length) + this;
};

if (self.cluster.isMaster){
	library.master(self);
}else{
	library.worker(self);
}
