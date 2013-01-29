# node-huffman

A simple multithreaded Node.js [Huffman Compression](http://www.cs.duke.edu/csed/poop/huff/info/) implementation.
This program was written in January 2013 for an university assignment. It is published here under the BSD license: do whatever you want with my code, it can even be included in proprietary programs as long as the license is respected.
I decided to use Node.JS as an experiment for this task even though C would have been the ideal choice.
The reasons for that choice are the following:
* It resulted in easy to read, short and clear parallel code
* It is reasonably fast
* The short development time allowed me to implement a multiple-trees system to increase the compression ratio without a performance hit.

This is not the cleanest code I've written, but I'm publishing it here because I'm proud of the work I did in such little time and hopefully it will be useful to someone.
Tested with node.js 0.8.18 and files of up to 80Mb.

## Usage

node comp.js compress|decompress \<filename\>
