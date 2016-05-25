// Modules
var time = require('time');
var _ = require('underscore');
var rest = require('restler');
var express = require('express');
var hash = require('object-hash');
var dateFormat = require('dateformat');
var q = require('promised-io/promise');
var gcreds = require('./Eric-Toggl-Worklog-Updater-8965f1889488.json');
var gsheet = require("google-spreadsheet");
var PushBullet = require('pushbullet');
var app = express();

// API Credentials
var apis = {
  toggl:{
    urls:{
      base: 'https://www.toggl.com/api/v8',
      reports: 'https://toggl.com/reports/api/v2'
    },
    key: '8974611fcc012b0d33093da0e2ed8cd5',
    user_agent: 'emcniece@gmail.com',
    workspace_id: 309840
  },
  sheets:{
    id: '1BWplFseqlyFEv3B3Jtuv8GXK1-LrY8QY84aW4S1yYRs',
    worksheet_id: 1 // Worksheet ID, starts at index 1
  },
  pushbullet:{
    key: 'o.8cVFoIcgE4w4eCOeHpXmOva5D9P311hk',
    device: 'ujyYjce8R9UsjAsoeMFET6'
  }
}

// Global settings
var togglSummaryHash = hash({});
var togglAdded = [];
var startTime = new Date();
var timesheet = new gsheet(apis.sheets.id);
var pusher = new PushBullet(apis.pushbullet.key);
//https://docs.google.com/spreadsheets/d/1BWplFseqlyFEv3B3Jtuv8GXK1-LrY8QY84aW4S1yYRs/edit#gid=25

var apiOpts = {
  username: apis.toggl.key,
  password: 'api_token'
};

/*
  PRIMARY ROUTES
*/
app.use(routeAll);
// Toggl
app.get('/', routeMain);
app.get('/today', routeToday);
app.get('/latest', routeLatest);
app.get('/summary', routeSummary);
app.get('/summary-short', routeSummaryShort);
// Sheets
app.get('/rows', routeRows);  // /rows?date=yyyy-mm-dd
app.get('/sync', routeSync);  // sync today
// Pushbullet
app.get('/devices', routeDevices);

/*
app.get('/test', function(){
  timesheet.addRow( 1, { description: 'col value 2'} );
  res.send('done')
});
*/

/*
  ROUTE CALLS
*/
function routeAll(req, res, next){
  console.log(req.method + ' ' + req.url );
  next();
}

function routeMain(req, res){
  queryApi(apis.toggl.urls.base, 'me').then(function(data){
    printRaw(res, data);
  });
}

function routeToday(req, res){
  var deferred = q.defer();

  var start = new time.Date();
  start.setTimezone('America/Vancouver');
  start.setHours(0,0,0,0);

  var end = new time.Date();
  end.setTimezone('America/Vancouver');
  end.setHours(23,59,59,999);

  var args = {
    query:{
      start_date: start.toISOString(),
      end_date: end.toISOString()
    }
  };

  queryApi(apis.toggl.urls.base, 'time_entries', args).then(function(data){
    if(res) printRaw(res, data);
    deferred.resolve(data);
  });

  return deferred.promise;
}

function routeLatest(req, res){
  queryApi(apis.toggl.urls.base, 'time_entries').then(function(data){
    printRaw(res, data);
  });
}

function routeSummary(req, res){
  var deferred = q.defer();
  var start;
  var end = null;

  if(req && req.query && req.query.date){
    start = parseDate(req.query.date);
  } else {
    start = new time.Date();
    start.setTimezone('America/Vancouver');
    start.setHours(0,0,0,0);
  }

  if(req && req.query && req.query.until){
    end = parseDate(req.query.until);
    end = end.toISOString();
  } else{
    end = new time.Date(start.getTime() );
    end = end.toISOString();
  }

  var args = {
    query:{
      user_agent: apis.toggl.user_agent,
      workspace_id: apis.toggl.workspace_id,
      since: start.toISOString(),
      until: end
    }
  };

  queryApi(apis.toggl.urls.reports, 'summary', args).then(function(data){
    if(res) printRaw(res, data);
    deferred.resolve(data);
  });

  return deferred.promise;
}

function routeSummaryShort(req, res){
  var deferred = q.defer();
  var entries = [];
  var date;

  if(req && req.query && req.query.date){
    date = parseDate(req.query.date);
  } else {
    date = new time.Date();
    date.setTimezone('America/Vancouver');
    date.setHours(0,0,0,0);
  }

  // Pass req in to ensure date is handled downstream
  routeSummary(req).then(function(summary){
    _.each(summary.data, function(project){
      var entry = {
        title: project.title.project,
        date: date.toISOString(),
        ms: 0,
        hours: 0,
        desc: []
      };

      _.each(project.items, function(line){
        entry.ms += line.time;
        entry.desc.push(line.title.time_entry);
      });

      entry.desc = entry.desc.join(', ');
      entry.hours = (entry.ms / 1000 / 60 / 60).toFixed(2);

      entries.push(entry);
    });

    if(res) printRaw(res, entries);
    deferred.resolve(entries);
  });

  return deferred.promise;
}

function routeRows(req, res){
  var date = parseDate(req.query.date);

  if(date){
    getRowsByDate(date).then(function(rows){
      if(res) printRaw(res, rows);
      return rows;
    });
  } else{
    getSheetRows().then(function(rows){
      if(res) printRaw(res, rows);
      return rows;
    });
  }
}

function routeSync(req, res){
  updateTimesheet(req).then(function(rows){
    printRaw(res, rows);
  });
}

function routeDevices(req, res){
  pusher.devices(function(e, response){
    printRaw(res, response);
  });
}

/*
  SERVER STARTUP
*/
var server = app.listen(8081, function () {

  var host = server.address().address
  var port = server.address().port

  console.log("Toggl Checker listening at http://%s:%s", host, port)
  pusher.note(apis.pushbullet.device, 'Toggl Checker', 'Starting app!');

  var init = q.all(testToggl() , testSheets() );
  init.then(function(returns){
    console.log('API tests complete! Starting monitoring process...');

    // TODO: get list of projects
    var togglTask = setInterval(togglSyncToday, 3000);

  }, function(error){
    console.log('API test failure:', error);
    console.log('Exiting app (Ctrl+C to close)');
    //process.exit();
  });
});

/*
  TASK LAYER
*/
function togglSyncToday(req){
  var deferred = q.defer();
  routeSummaryShort().then(function(summary){

    // Ensure we have a proper 'today' summary
    if(summary.length && hash(summary) !== togglSummaryHash){
      console.log( 'Updating Summary... ');
      togglSummaryHash = hash(summary);

      updateTimesheet(req).then(function(){
        console.log('-- Summary update complete!');
        deferred.resolve();
      });
    }

  });

  return deferred.promise;
}

function updateTimesheet(req){
  var deferred = q.defer();
  var date;

  if(req && req.query && req.query.date){
    date = parseDate(req.query.date);
  } else {
    date = new time.Date();
    date.setTimezone('America/Vancouver');
    date.setHours(0,0,0,0);
  }

  getRowsByDate(date).then(function(sheetRows){
    routeSummaryShort(req).then(function(togglRows){

      if(!togglRows.length) return;

      _.each(togglRows, function(togglRow){
        var togglDate = dateFormat(togglRow.date, 'm/d/yyyy');
        var togglMonth = dateFormat(togglRow.date, "'m/yyyy");
        var togglDay = dateFormat(togglRow.date, "dddd");
        var rowUpdated = false;

        _.each(sheetRows, function(sheetRow){

          // existing project?
          if( (togglDate == sheetRow.date) && (togglRow.title == sheetRow.project)){
            console.log('Updating existing project: ' + togglRow.title+' '+togglDate);
            pusher.note(apis.pushbullet.device, 'Toggl Checker', 'Updated: '+togglRow.title+' '+togglDate);

            sheetRow.description = togglRow.desc;
            sheetRow.hours = togglRow.hours;
            sheetRow.weekday = togglDay;

            // Auto-formats to date when it hits the sheet... place a comma
            // in front to prevent this in the cell display
            sheetRow.month = togglMonth;
            sheetRow.save();
            rowUpdated = true;
          }
        });

        // Add new row!
        if( !rowUpdated){
          var newRow = {
            date: togglDate,
            month: togglMonth,
            weekday: togglDay,
            project: togglRow.title,
            hours: togglRow.hours,
            description: togglRow.desc
          };

          timesheet.addRow(apis.sheets.worksheet_id, newRow, function(rowOrError){
            pusher.note(apis.pushbullet.device, 'Toggl Checker', 'Added: '+togglRow.title+' '+togglDate);
            console.log('Adding new row: ', rowOrError);
          });
        }
      });
    });

    deferred.resolve(sheetRows);

  }, function(error){
    console.log('updateTimesheet Error:', error);
  });

  return deferred.promise;
}

function getSheetRows(){
  var deferred = q.defer();

  var opts = {
    offset: 0,
    limit:2000
  };

  timesheet.getRows( apis.sheets.worksheet_id, opts, function( err, rows ){
    if(err){
      deferred.reject(err);
    } else{
      deferred.resolve(rows);
    }
  });

  return deferred.promise;
}

// Date should be ISO format: yyyy-mm-dd
function getRowsByDate(date){
  var deferred = q.defer();

  getSheetRows().then(function(rows){
    if(!date){
      deferred.reject('invalid date');
      return;
    }

    var formattedDate = dateFormat(date, 'm/d/yyyy');

    rows = _.filter(rows, function(row){
      return row.date === formattedDate;
    });

    deferred.resolve(rows);
  });

  return deferred.promise;
}

/*
  API INIT TESTS
*/
function testToggl(){
  var deferred = q.defer();
  console.log('- Testing Toggl API... ');

  queryApi(apis.toggl.urls.base, 'me').then(function(data){
    console.log('-- Toggl API Pass');
    deferred.resolve();
  }, function(error){
    console.log('-- Toggl API fail');
    deferred.reject(error);
  });

  return deferred.promise;
}

function testSheets(){
  var deferred = q.defer();
  console.log('- Testing Sheets API... ');

  timesheet.useServiceAccountAuth(gcreds, function(err){
    if(err){
      deferred.reject(err);
    } else{

      timesheet.getInfo( function( err, sheet_info ){
        if(err){
          console.log('-- Toggl API fail');
          deferred.reject(err);
        } else if(sheet_info && sheet_info.title){
          //console.log( sheet_info.title + ' is loaded' );
          console.log( '-- Sheets API Pass');
          deferred.resolve();
        } else{
          console.log('-- Toggl API fail');
          deferred.reject('timesheet.getInfo error');
        }
      });
    }
  });

  return deferred.promise;
}

/*
  API COMMUNICATION LAYER
*/
function queryApi(base, endpoint, reqData) {
  var deferred = q.defer();
  url = base.replace(/\/?$/, '/') + endpoint;

  // Leave apiOpts alone, merge into a clone - this gets shared (nasty)
  var reqOpts = _.clone(apiOpts);
  if(reqData) reqOpts = _.extend(reqOpts, reqData);

  rest.get(url, reqOpts)
    .on('success', function(data){
      deferred.resolve(data);
    })
    .on('fail', function(data, res){
      console.log('API fail.', res.statusCode, res.statusMessage, url, reqOpts )
      deferred.reject(res.statusCode + ' '+res.statusMessage);
    })
    .on('complete', function(data) {
      // This fires before success and fail events! lame
      //deferred.resolve(data);
    });

  return deferred.promise;
}

function printRaw(res, content){
  res
    .set({'Content-Type': 'application/json; charset=utf-8'})
    .status(200)
    .send(JSON.stringify(content, undefined, ' '));
}

// Take date from query args and return a date object
// qDate = yyyy-mm-dd (2016-02-15)
function parseDate(qDate){
  if(!qDate) return false;

  var dateArr = qDate.split('-');
  if( dateArr.length < 3){
    console.log('Error: invalid date length. ' + qDate);
    return false;
  }
  var date = new time.Date(dateArr[0], dateArr[1] - 1, dateArr[2],  "America/Vancouver");
  return date || false;
}
