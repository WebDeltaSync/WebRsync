var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var fs = require("fs");

var index = require('./routes/index');
var users = require('./routes/users');
var BSync = require('./public/js/bit-sync');

var fileUpload = require('express-fileupload');


var arrayBufferToBuffer = require('arraybuffer-to-buffer');

var basePath = __dirname + "/upload/";

var app = express();

var server = require('http').Server(app);
var io = require('socket.io')(server);

server.listen(8081);

/* match_cache = [filename1:(1234 bytes,matchdoc],
    }
 */
var filename_cache = {};
var match_cache = {};
var patch_cache = {};
var patch_num_cache = {};

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', index);
app.use('/users', users);
app.use(fileUpload());

app.post('/upload', function(req, res) {
    var sampleFile;

    if (!req.files) {
        res.send('No files were uploaded.');
        return;
    }

    sampleFile = req.files.sampleFile;
    sampleFile.mv(__dirname + '/upload/' + sampleFile.filename, function(err) {
        if (err) {
            res.status(500).send(err);
        }
        else {
            res.send('File uploaded!');
        }
    });
});



// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

io.on('connection', function(socket)
{
    console.log('new connect!');
    socket.on('startsync',function(req){
        console.log('start_rsync:',req.filename);
        filePath = basePath + req.filename;

        fs.stat(filePath, function (err,stat) {

            if (err == null) {
                getFileData(filePath,function(data){
                    data.byteLength = data.length;
                    console.log('start get checksumdoc 1...',data.length);
                    checksumdoc = BSync.createChecksumDocument(req.blocksize,data);
                    console.log('<< checksumdoc');
                    socket.emit('checksumdoc',{filename:req.filename,checksumdoc:checksumdoc});
                })
            } else {
                console.log('start get checksumdoc 2...');
                checksumdoc = BSync.createChecksumDocument(req.blocksize,new ArrayBuffer(0));
                console.log('<< checksumdoc');
                socket.emit('checksumdoc',{filename:req.filename,checksumdoc:checksumdoc});
            }
        });
    });

    socket.on('patchdoc',function(req){
        patchdoc = req.patchdoc;
        filepath = basePath + req.filename;

        patchdocView = new Uint8Array(patchdoc);
        patchdoc = patchdocView.buffer
        fs.stat(filePath, function (err,stat) {

            if (err == null) {

                getFileData(basePath + req.filename,function(data){
                    console.log('original data is',data.length);
                    newfiledata = BSync.applyPatch(patchdoc,data);
                    console.log('write length',newfiledata.byteLength)

                    fs.writeFile(filePath,arrayBufferToBuffer(newfiledata),function(err){
                        if (err){
                            throw 'error writing file: ' + err;
                        }
                        else{
                            console.log('file write over~ 2');
                            BlockSyncStatus = 'success';
                            socket.emit('SyncOver', BlockSyncStatus);
                        }
                        //reset cache
                        delete match_cache[req.filename]
                        delete patch_num_cache[req.filename]
                        delete patch_cache[req.filename]
                    })
                });
            } else {
                data = new ArrayBuffer(0);
                newfiledata = BSync.applyPatch(patchdoc,data);
                fs.writeFile(filePath,arrayBufferToBuffer(newfiledata),function(err){
                    if (err){
                        throw 'error writing file: ' + err;
                    }
                    else{
                        console.log('file write over~ 1');
                        BlockSyncStatus = 'success';
                        socket.emit('SyncOver', BlockSyncStatus);
                    }
                    //reset cache
                    delete match_cache[req.filename]
                    delete patch_num_cache[req.filename]
                    delete patch_cache[req.filename]
                })
            }
        });

    });

});

// 在服务器端读取文件
function getFileData(file, callback)
{
    fs.readFile(file, function(err, data) {
        if (err) {
            // console.error("Error getting file data: " + err);
        }
        callback(data);
    });
}


module.exports = app;
