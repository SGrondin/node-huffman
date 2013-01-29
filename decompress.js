exports.master = function(context){
	var self = context;
	console.log("Decompressing "+self.fileName);
	self.counters = {
		NBPROCESSES : self.NBPROCESSES,
		NBREADY : 0,
		NBDECOMPRESSED : 0
	};
	self.decompressedChunks = [];
	
	//Manage workers
	for (var i=0;i<self.counters.NBPROCESSES;i++){
		var worker = self.cluster.fork();
		//Listen for commands from the new worker
		worker.on("message", function(msg){
			if (msg.ready){
				self.counters.NBREADY++;
				if (self.counters.NBREADY === self.counters.NBPROCESSES){
					console.log(self.counters.NBREADY+" workers successfully started. T+"+((new Date).getTime() - self.t1.getTime()));
					self.decompressSlices();
				}
			}else if (msg.decompressed){
				self.decompressedChunks[msg.decompressed.sliceID] = msg.decompressed;
				self.counters.NBDECOMPRESSED++;
				if (self.counters.NBDECOMPRESSED === self.nbHeaders){
					self.cluster.disconnect();
					console.log(self.counters.NBDECOMPRESSED+" slices decompressed. T+"+((new Date).getTime() - self.t1.getTime()));
					console.log("Writing file... T+"+((new Date).getTime() - self.t1.getTime()));
					var outputFile = "AAA"+self.fileName.substring(0, self.fileName.length-5);
					self.fs.writeFileSync(__dirname + "/"+outputFile, "");
					for (var i=0;i<self.decompressedChunks.length;i++){
						self.fs.appendFileSync(__dirname + "/"+outputFile, self.decompressedChunks[i].data, "base64");
					}
					console.log("Done. T+"+((new Date).getTime() - self.t1.getTime()));
				}
			}else{
				console.log("Unrecognized message:");
				con(Object.keys(msg));
				con(msg);
			}
		});
	}
	//Send IDs to workers
	for (var i=1;i<=self.counters.NBPROCESSES;i++){
		self.cluster.workers[i].send({"ID" : i});
	}
	
	
	self.decompressSlices = function(){
		var data = self.fs.readFileSync(__dirname + "/"+self.fileName);
		
		//First 2 bytes: number of headers (same as number of slices)
		self.nbHeaders = parseInt(data[0].toString(2)+data[1].toString(2).lpad("0", 8), 2);
		
		//Rebuilding headers
		var offset = 2;
		var headers = [];
		while (headers.length !== self.nbHeaders){
			var h = {"len" : 0, "table" : self.getBlankArray()};
			//First 4 bytes of each header: number of bits for that header
			h.len = parseInt(data[offset].toString(2).lpad("0", 8)+data[offset+1].toString(2).lpad("0", 8)+data[offset+2].toString(2).lpad("0", 8)+data[offset+3].toString(2).lpad("0", 8), 2);
			offset+=4;
			var i = 0;
			var code = "";
			while (i<256){
				if (data[offset] > 0){
					var nbBytes = Math.ceil(data[offset]/8);
					for (var j=0;j<nbBytes;j++){
						code += data[offset+j+1].toString(2).lpad("0", 8);
					}
					code = code.substring((nbBytes*8) - data[offset]);
					h.table[code.length][parseInt(code, 2)] = i;
					code = "";
					offset += nbBytes+1;
					i++
				}else{
					offset++;
					i++;
				}
			}
			headers.push(h);
		}
		
		for (var i=0;i<headers.length;i++){
			var params = {"decompressSlice" : {"sliceID" : i, "data" : data.slice(offset, offset+Math.ceil(headers[i].len/8)).toString("base64"), "len" : headers[i].len, "table" : headers[i].table}};
			self.cluster.workers[(i%self.counters.NBPROCESSES)+1].send(params);
			offset += Math.floor(headers[i].len/8)+1;
		}
		console.log(self.nbHeaders+" headers analyzed. T+"+((new Date).getTime() - self.t1.getTime()));
	};
	
	
	
	
};

exports.worker = function(context){
	var self = context;
	
	process.on("message", function(msg){
		if (msg.ID){
			self.ID = msg.ID;
			process.send({"ready" : true});
		}else if (msg.decompressSlice){
			self.decompressSlice(msg.decompressSlice);
		}
	});
	
	self.decompressSlice = function(msg){
		var data = new Buffer(msg.data, "base64");
		var bin = "";
		for (var i=0;i<data.length;i++){
			bin += data[i].toString(2).lpad("0", 8);
		}
		bin = bin.substring(0, msg.len);
		var arr = [];
		var str = "";
		var chr;
		for (var i=0;i<bin.length;i++){
			str += bin[i];
			chr = msg.table[str.length][parseInt(str, 2)]
			if (chr !== null && chr !== undefined && chr >= 0){
				arr.push(chr);
				str = "";
			}
		}
		var output = new Buffer(arr);
		process.send({"decompressed" : {"sliceID" : msg.sliceID, "data" : output.toString("base64")}});
	};
	
};
