exports.master = function(context){
	var self = context;
	console.log("Compressing "+self.fileName);
	self.counters = {
		NBPROCESSES : self.NBPROCESSES,
		NBREADY : 0,
		NBCOMPRESSED : 0,
		NBFORMATTED : 0
	};
	self.nbSlices = 1;
	self.binChunks = [];
	self.formattedChunks = [];
	self.bin = "";
	self.padding = 0;
	self.slices = [];
	
	
	//Manage workers
	for (var i=0;i<self.counters.NBPROCESSES;i++){
		var worker = self.cluster.fork();
		//Listen for commands from the new worker
		worker.on("message", function(msg){
			if (msg.ready){
				self.counters.NBREADY++;
				if (self.counters.NBREADY === self.counters.NBPROCESSES){
					console.log(self.counters.NBREADY+" workers successfully started. T+"+((new Date).getTime() - self.t1.getTime()));
					self.workersCompressSlices();
				}
			}else if (msg.compressed){
				self.binChunks[msg.compressed.sliceID] = msg.compressed; //Adding the object to not copy the string needlessly
				self.counters.NBCOMPRESSED++;
				if (self.counters.NBCOMPRESSED === self.nbSlices){
					console.log(self.counters.NBCOMPRESSED+" slices compressed. T+"+((new Date).getTime() - self.t1.getTime()));
					for (var i=0;i<self.binChunks.length;i++){
						self.bin += self.binChunks[i].data;
						self.binChunks[i].data = null;
						if ((self.bin.length % 8) > 0){
							self.bin += "0".repeat(8 - (self.bin.length % 8));
						}
					}
					self.workersFormat();
				}
			//It seems weird to not do the formatting at the same time as the compression, but this method ended up being massively faster
			}else if (msg.formatted){
				self.formattedChunks[msg.formatted.processID] = msg.formatted;
				self.counters.NBFORMATTED++;
				if (self.counters.NBFORMATTED === self.counters.NBPROCESSES){
					self.cluster.disconnect();
					console.log(self.counters.NBFORMATTED+" chunks formatted. T+"+((new Date).getTime() - self.t1.getTime()));
					
					//Write the number of headers in the first 2 bytes
					var strNbHeaders = self.binChunks.length.toString(2).lpad("0", 16);
					var nbHeaders = new Buffer([parseInt(strNbHeaders.substring(0,8), 2), parseInt(strNbHeaders.substring(8), 2)]);
					console.log("Writing file... T+"+((new Date).getTime() - self.t1.getTime()));
					self.fs.writeFileSync(__dirname+"/"+self.fileName+".comp", nbHeaders);
					//Write all headers
					for (var i=0;i<self.binChunks.length;i++){
						self.fs.appendFileSync(__dirname+"/"+self.fileName+".comp", self.binChunks[i].header, "base64");
					}
					//Write the body
					for (var i=1;i<self.formattedChunks.length;i++){
						self.fs.appendFileSync(__dirname+"/"+self.fileName+".comp", self.formattedChunks[i].data, "base64");
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
	
	self.workersCompressSlices = function(){ //Split the slices between the available workers
		var fileLength = self.fs.statSync(self.fileName).size;
		if (fileLength === 0){
			console.log("File is empty");
			process.exit(0);
		}
		var sliced = 0;
		if (Math.floor(fileLength/self.sliceSize) > 0){
			self.nbSlices = Math.floor(fileLength/self.sliceSize);
		}
		for (var i=0;i<self.nbSlices;i++){
			if (i !== (self.nbSlices-1)){
				var params = {"compressSlice" : {"sliceID" : i, "begin" : sliced, "end" : sliced+self.sliceSize}};
				sliced += self.sliceSize;
			}else{
				var params = {"compressSlice" : {"sliceID" : i, "begin" : sliced, "end" : fileLength}};
			}
			self.slices.push(params.compressSlice);
			self.cluster.workers[(i%self.counters.NBPROCESSES)+1].send(params);
		}
	}
	
	self.workersFormat = function(){ //One slice per worker
		var binLength = self.bin.length;
		var sliced = 0;
		var sliceWidth = Math.round(binLength/self.counters.NBPROCESSES);
		sliceWidth += 8 - (sliceWidth % 8); //Making sure the width is a full byte
		for (var i=1;i<=self.counters.NBPROCESSES;i++){
			if (i !== self.counters.NBPROCESSES){
				var params = {"format" : self.bin.substring(sliced, sliced+sliceWidth)};
			}else{
				var params = {"format" : self.bin.substring(sliced)};
			}
			self.cluster.workers[i].send(params);
			sliced += sliceWidth;
		}
	}
};

exports.worker = function(context){
	var self = context;
	self.ID = 0;
	
	process.on("message", function(msg){
		if (msg.ID){
			self.ID = msg.ID;
			process.send({"ready" : true});
		}else if (msg.compressSlice){
			self.compressSlice(msg.compressSlice.sliceID, msg.compressSlice.begin, msg.compressSlice.end);
		}else if (msg.format){
			self.format(msg.format);
		}
	});
	self.compressSlice = function(sliceID, begin, end){
		//Get file slice
		var data = self.fs.readFileSync(self.fileName).slice(begin, end);
		//Calculate character frequencies
		var freq = self.getBlankArray();
		for(var i=0;i<data.length;i++){
			freq[data[i]].nb++;
		}
		//Sort: nb ASC, ind ASC
		freq.sort(function(a, b){
			if (a.nb === 0){
				return (b.nb === 0) ? 0 : -1;
			}else{
				if (b.nb === 0){
					return 1;
				}else{
					return (b.nb - a.nb === 0) ? (a.ind - b.ind) : (a.nb - b.nb);
				}
			}
		});
		//Remove empty characters
		while(freq[0].nb === 0){
			freq.shift();
		}
		//Build table from tree
		var table = [];
		self.buildTree(freq, table);
		//Compress data
		var bin = "";
		var len = data.length;
		for (var i=0;i<len;i++){
			bin += table[data[i]];
		}
		//Build header
		//First 4 bytes: number of bits in that compressed slice
		var fourBytes = bin.length.toString(2).lpad("0", 32);
		var arr = [parseInt(fourBytes.substring(0, 8), 2), parseInt(fourBytes.substring(8, 16), 2), parseInt(fourBytes.substring(16, 24), 2), parseInt(fourBytes.substring(24, 32), 2)];
		//Add the table
		var nbBytes = 1;
		var code = "";
		for (var i=0;i<256;i++){
			if (table[i]){
				//Character length
				arr.push(parseInt(table[i].length.toString(2).lpad("0", 8), 2));
				//Character code, on 1 or more bytes
				nbBytes = Math.ceil(table[i].length/8);
				code = table[i].lpad("0", nbBytes*8);
				for (var j=0;j<nbBytes;j++){
					arr.push(parseInt(code.substring(j*8, (j+1)*8), 2));
				}
			}else{
				arr.push(0);
			}
		}
		var header = new Buffer(arr);
		//Pad the bin string to round up a byte
		bin += "0".repeat(8 - (bin.length % 8));
		
		process.send({"compressed" : {"sliceID" : sliceID, "data" : bin, "header" : header.toString("base64")}});
	}
	
	self.buildTree = function(tree, table){
		// Merge two smallest, recursively
		tree.sort(function(a, b){
			if (a.nb === 0){
				return (b.nb === 0) ? 0 : -1;
			}else{
				if (b.nb === 0){
					return 1;
				}else{
					return a.nb - b.nb;
				}
			}
		});
		try{
			var nb = (tree[0].nb + tree[1].nb);
		}catch(e){
			con(tree);
		}
		
		var node = {"nb" : nb, "left" : tree[0], "right" : tree[1], "childs" : []};
		if (node.left.ind >= 0){
			table[node.left.ind] = "0";
			node.childs.push(node.left.ind);
		}else{
			for (var i=0;i<node.left.childs.length;i++){
				table[node.left.childs[i]] = "0" + table[node.left.childs[i]];
			}
			node.childs = node.childs.concat(node.left.childs);
		}
		if (node.right.ind >= 0){
			table[node.right.ind] = "1";
			node.childs.push(node.right.ind);
		}else{
			for (var i=0;i<node.right.childs.length;i++){
				table[node.right.childs[i]] = "1" + table[node.right.childs[i]];
			}
			node.childs = node.childs.concat(node.right.childs);
		}
		tree.splice(0, 2, node);
		
		if (tree.length > 1){
			self.buildTree(tree, table);
		}
	}
	
	self.format = function(bin){
		var arr = [];
		var len = bin.length;
		for (var i=0;i<len;i+=8){
			arr.push(parseInt(bin.substring(i,i+8),2));
		}
		output = new Buffer(arr);
		
		process.send({"formatted" : {"processID" : self.ID, "data" : output.toString("base64")}});
	}
};