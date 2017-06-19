
const API_URL_PRINT = '/api/v1/print_job';
const API_URL_STATUS = '/api/v1/printer/status';
const API_URL_CAMERA = 'api/v1/camera';
const API_URL_IMAGE_SNAPSHOT = ':8080/?action=snapshot.jpg';
const STATUS_IDLE = "idle";
const STATUS_PRINTING = "printing";
const STATUS_PAUSED = "paused";
const STATUS_RESUMING = "resuming";
const STATUS_PREPRINT = "pre_print";
const STATUS_POSTPRINT = "post_print";
const STATUS_CLEANUP = "wait_cleanup";
const STATUS_ERROR = "error";
const STATUS_MAINTENENCE = "maintenence";
const STATUS_BOOTING = "booting";
const ULTIMAKER_FILE =".gcode.gz";

var config = require('./config');

var async = require('async');
var builder = require('botbuilder');

var express = require('express');
var fs = require('fs');
var http = require('http');
var mkdirp = require('mkdirp');
var path = require("path");
var request = require('request');
var spsave = require("spsave").spsave;
var zpad = require('zpad');

var app = express();
// Variables for the app, dirty styles. 
var count = 0;
var hasCreatedFolder = false;
var isTakingPhotos = false;
var addedToDB = false;
var theFolderName='';
var printerStatus = null;

var MongoClient = require('mongodb').MongoClient;

var coreOptions = {
  siteUrl: config.sharePointSite,
  flatten:false

};
var creds = {
  username: config.sharePointUser,
  password: config.sharePointPass
};
var fileOptions = {
  folder: config.sharePointFolder
};

/*ROUTING FOR THE APPLICATION */

//Returns the Camera feed url 
app.get('/camera', function (req, res) {
    var url = config.printer_ip + API_URL_CAMERA;
    request(url, function (error, response, body) {
        res.send(body);
    })
});

// Returns the status of what kit is doing

app.get('/status', function (req, res) {
    var url = config.printer_ip + API_URL_PRINT;
    request(url, function (error, response, body) {
        if (response.statusCode == 200) {
            res.end('Kitt is currently ' + body);
        } else {
            res.end("Error getting printer status.");
        }
    });
});

/*Get the Picture Url */

app.get('/picture', function (req, res) {
    var url = config.printer_ip + API_URL_IMAGE_SNAPSHOT;
    res.send (url);
})


app.get('/print', function (req, res) {
    res.send(printerStatus);
});

function formatStatus(result) {
    var status = '';
    if (result.statusCode && result.statusCode == 200) {
        status = formatPrintStatus(result);
    } else if (result.statusCode == 404 && result.message == "Not found") {
        // The Ultimaker API returns a 404 if nothing is printing - and a message of "not found". 
        // Not sure why they would 404 it, but checking against it and the message
        status = "Kitt is currently not printing anything."
    } else {
        status = "Error returning information for printing."
    }
    return (status);
}

/* 
Monitor the Printer
Runs on a loop to check the status of the printer. 
Will kick off certain process when it detects them ( create images for example) by setting variables. 
*/
function monitorPrinter() {
    /* using waterfall because there are some dependancies
    Starting with getting the status of the printer 
    */
    async.waterfall([
        getPrintStatus,
        function(result,callback){
            theFolderName = result.name.substr(0,result.name.indexOf(ULTIMAKER_FILE));
            directoryPath = "./images/"+theFolderName;
           // console.log(result.state);
           // console.log("monitorPrinter[function] ",result);
            if(result.state == STATUS_PREPRINT){
                //If we are about to print, we want to set things like added to db to false. 
                addedToDB = false; 
                
                // If we haven't created a Folders
                if(!hasCreatedFolder){
                    async.waterfall([
                        function(cb1){
                            makeDirectory(directoryPath,cb1);
                        }
                    ],
                    function(directoryPath,cb1){
                        hasCreatedFolder=true;
                        callback(null);
                    });
                }else{
                    callback(null);
                }
            }
            
            else if(result.state == STATUS_PRINTING && !isTakingPhotos){
                console.log("PHOTOS");
                isTakingPhotos = true;
                getImage();
                callback(null);
            }
            else if(result.state == STATUS_CLEANUP && !addedToDB){
                //We need to add to the database now
                addedToDB = true;
                addToDatabase(result); 
                resetPhotoValues()
                callback(null);
            }else if(result.state == STATUS_IDLE || result.state == STATUS_MAINTENENCE){
                // Not sure order of events, put this here. 
                resetPhotoValues();
            }
            else{
                 callback(null);
            }
        }
    ], function () {
        // repeat
        
        monitorPrinter();
    })
}
// Resets Booleans for photo taking values
function resetPhotoValues(){
    hasCreatedFolder = false;
    isTakingPhotos = false;
}

// Doesn't matter when this happens
function addToDatabase(res)
{
    //Add the path to where the user can get the images to store
    res.imagepath = config.sharePointBaseUrl+"/"+theFolderName;

    MongoClient.connect(config.mongoDBURL, function(err, db) {
        db.collection("kitt").insert(res, function(err, result) {
            if (err) {
                console.log(err);
            }
            db.close();
        });
    });
}

/*
getPrinterStatus(callback)
Calls the api to get the printer status, requires a callback. 
Simply returns the result for the print. 
If nothing is printing, the api returns {message:"Not found"}
*/

function getPrintStatus(printStatusCallback) {
    var url = config.printer_ip + API_URL_PRINT;
    request(url, function (error, response, body) {
        var result = JSON.parse(body);
        /*Set the Printer Status*/
        printerStatus = result;
        printStatusCallback(null, result);
    });
}


/*
makeDirectory
Uses mkdirp node module
*/
function makeDirectory(directoryName,makeDirectoryCallback){
    mkdirp(directoryName, function (err) {
        hasCreatedFolder = true;
        makeDirectoryCallback(directoryName,null);
    });
}

/*
Download the image from the URI
*/
function download(uri, filename, callback) {
    request.head(uri, function (err, res, body) {
        request(uri).pipe(fs.createWriteStream(filename)).on('close', callback);
    });
};

/*
Recursively gets an image while the 'is_printing' variable is true
This variable is set in the 'monitorPrinter' function. 
Saves a photo every 500 ms to the destination specified. 
*/
function getImage() {
    var url = config.printer_ip + API_URL_IMAGE_SNAPSHOT;
    var numberedImage = zpad(count,4);
    var destPath = directoryPath+"/"+"image"+numberedImage + ".jpg";
    // use waterfall to ensure we do one process after another
    console.log("getImage[function]");
    console.log("getImage[function] printer state is "+printerStatus.state);
    if(printerStatus.state && printerStatus.state==STATUS_PRINTING){
        download(url, destPath, function (data) {
            console.log(destPath)
            uploadImage(destPath);
            setTimeout(function () {
                count++;
                getImage();
            }, 10000);
        });
    }
};

function uploadImage(destPath)
{
    console.log('uploadImage and file: '+destPath)
    spsave(
        {
            siteUrl: coreOptions.siteUrl,
        }, 
        creds, {
            glob:destPath,
            base: config.sharePointBaseFolder,
            folder: config.sharePointFolder
        });
}
/*
getStatusMessage(body)
Formats the status to have more human readable messages. 
 */
function getStatusMessage(body) {
    var status = 'Kitt is idle';
    switch (body.status) {
        case (STATUS_PRINTING):
            status = "Kitt is currently printed";
            break;
        case (STATUS_PAUSED):
            status = "Kitt is taking a break and is paused";
            break;
        case (STATUS_RESUMING):
            status = "Kitt is resuming";
            break;
        case (STATUS_PREPRINT):
            status = "Kitt is preparing to print";
            break;
        case (STATUS_POSTPRINT):
            status = "Kitt has just finished a print";
            break;
        case (STATUS_CLEANUP):
            status = "Kitt is finished the print and it needs to be removed";
            break;
        case (STATUS_BOOTING):
            status = "Kitt is booting up";
            break;
        case (STATUS_ERROR):
            status = "Something is wrong with Kitt and needs immediate attention";
            break;
        case (STATUS_MAINTENENCE):
            status = "Kitt is being looked at by someone at the moment. ";
            break;
    }
    return (status);
}

/* 
formatPrintStatus
Formats the overall status messages including time and percentage as one chunk of information. 
*/
function formatPrintStatus(body) {
    var status = getStatusMesssage(body.state);
    var str = '';
    str += (status + " " + body.name);
    str += "\n";
    var progress = Math.round(Number(body.progress) * 100);
    str += "This job is about " + progress + "% done";
    str += "\n";
    str += "This print has taken " + body.time_elapsed + " and will take " + body.time_total;
    return str;
}


var server = app.listen(8081, function () {

    var host = server.address().address
    var port = server.address().port
    console.log("Example app listening at http://%s:%s", host, port)

})


// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: config.MICROSOFT_APP_ID,
    appPassword: config.MICROSOFT_APP_PASSWORD
});

// Listen for messages from users 
app.post('/api/messages', connector.listen());

// Receive messages from the user and respond by echoing each message back (prefixed with 'You said:')


var bot = new builder.UniversalBot(connector, function (session) {
    console.log("I HEARD SOMETHING");
    console.log(session.message.text);
    session.send("You said: %s", session.message.text);
});

// call recursiveFunction 
monitorPrinter();

