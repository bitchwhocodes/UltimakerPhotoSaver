# Ultimaker Server 

This is a node/express server that is constantly monitoring the Ultimaker's api and will save pictures every 10 seconds when its printing, put them in a folder named the same as the file being printed and then upload it to Sharepoint. It also logs the print data to a MongoDB. 

This requires some configuration. Missing is a config.js that you will have to make at the root that will store all the values you need. 

var config={};
config.printer_ip = [IP TO PRINTER]
config.mongoDB = [MONGOLAB MONGO DB NAME];
config.mongoDBURL = [MONGODBURL CONNECTION STRING]
config.sharePointSite=[SHAREPOINT SITE ]
config.sharePointFolder=[FOLDER ON SHAREPOINT ( SiteAssets/myfolder)]
config.sharePointBaseUrl=[LINK TO BASE IMAGES FOLDER WHERE YOU ARE STORING THEM]
config.sharePointUser=[USERNAME]
config.sharePointPass=[PASSWORD]
config.sharePointBaseFolder ="images";


module.exports = config;
