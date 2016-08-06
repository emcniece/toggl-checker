// Modules
var time = require('time');
var _ = require('underscore');
var rest = require('restler');
var express = require('express');
var hash = require('object-hash');
var dateFormat = require('dateformat');
var q = require('promised-io/promise');
var async = require('async');
var gcreds = require('./Eric-Toggl-Worklog-Updater-8965f1889488.json');
var gsheet = require("google-spreadsheet");
var PushBullet = require('pushbullet');
var app = express();

/*
  To add this to a new sheet, invite the email address from the JSON file.
  eric-toggl-worklog-updater@appspot.gserviceaccount.com
*/

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
    //id: '1BWplFseqlyFEv3B3Jtuv8GXK1-LrY8QY84aW4S1yYRs', // old sheet
    id: '1VA44ZzEMdq0iX0EQmc5jp8AODSapF59lcxE0DYYlpjY',   // new sheet
    worksheet_id: 1 // Worksheet ID, starts at index 1
  },
  pushbullet:{
    key: 'o.8cVFoIcgE4w4eCOeHpXmOva5D9P311hk',
    device: 'ujyYjce8R9UsjAsoeMFET6'
  }
}

// Global settings
var togglSummaryHash = hash({});
var togglProjects = {};
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
app.get('/toggl/today', routeToday);
app.get('/toggl/latest', routeLatest);
app.get('/toggl/summary', routeSummary);
app.get('/toggl/summary-short', routeSummaryShort);
app.get('/toggl/latest-short', routeLatestSummary);
// Sheets
app.get('/sheets/rows', routeRows);  // /rows?date=yyyy-mm-dd
app.get('/sheets/sync', routeSync);  // sync today
// Pushbullet
app.get('/pushbullet/devices', routeDevices);

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

function routeLatestSummary(req, res){
  var deferred = q.defer();

  queryApi(apis.toggl.urls.base, 'time_entries').then(function(data){
    _.each(data, function(entry){
      var project = _.findWhere(togglProjects, {id: entry.pid})
      if(project) entry.project = project.name;
    });

    data = _.groupBy(data, function(entry){ return dateFormat(entry.stop, 'yyyy-mm-dd') });

    var dateGroups = {};
    _.each(data, function(dateGroup, date){
      projGroup = _.groupBy(dateGroup, function(entry){ return entry.pid; });

      projGroup = _.map(projGroup, function(project, pid){
        var sum = _.reduce(project, function(memo, val){ return memo + val.duration }, 0);
        var desc = _.reduce(project, function(memo, val){

        if(!memo){
            return val.description;
          } else if(memo.indexOf(val.description) == -1)
            return memo + ', ' + val.description
        }, "");

        return { name: pid, hours: (sum/60/60).toFixed(2), description: desc, project: project[0].project}
      });

      dateGroups[date] = projGroup;
    });

    if(res) printRaw(res, dateGroups);
    deferred.resolve(dateGroups);
    return dateGroups;
  });

  return deferred.promise;
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

  var init = q.all(testToggl(), testSheets() );
  init.then(function(returns){
    console.log('API tests complete! Starting monitoring process...');

    togglSyncProjects();
    var togglTask = setInterval(togglSyncLatest, 3000);
    var togglProjectUpdater = setInterval(togglSyncProjects, 3600000);

  }, function(error){
    console.log('API test failure:', error);
    console.log('Exiting app (Ctrl+C to close)');
    //process.exit();
  });
});

/*
  TASK LAYER
*/
function togglSyncProjects(){
  queryApi(apis.toggl.urls.base, 'workspaces/'+apis.toggl.workspace_id+'/projects').then(function(projects){
    togglProjects = projects;
  });
}

function togglSyncToday(){
  var deferred = q.defer();

  routeSummaryShort(req).then(function(summary){

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

function togglSyncLatest(){
  var deferred = q.defer();
  var d = new Date();


  var req = {
    query: {
      date: dateFormat(d.setDate(d.getDate()), 'yyyy-mm-dd')
    }
  }

  routeSummaryShort(req).then(function(summary){

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
  var newRows = [];

  getSheetRows().then(function(sheetRows){

    routeLatestSummary(req).then(function(togglRows){
      if(!_.keys(togglRows).length) return;

      _.each(togglRows, function(togglRow, togglRowDate){
        var togglDate = dateFormat(togglRowDate, 'm/d/yyyy');
        var monthYear = dateFormat(togglRowDate, 'm/yyyy');
        var year = dateFormat(togglRowDate, 'yyyy');

        // TODO: sync this number with Sheet's WEEKNUM
        var week = dateFormat(togglRowDate, 'W');
        var rowUpdated = false;

        _.each(togglRow, function(togglEntry){
          // Skip in-progress entries
          if(togglEntry.hours < 0) return;

          _.each(sheetRows, function(sheetRow){

            // existing project?
            if((togglDate == sheetRow.date) && (togglEntry.project == sheetRow.project) ){
              rowUpdated = true;

              if((togglEntry.hours !== sheetRow.hours) || (togglEntry.description !== sheetRow.description) ){
                console.log('Updating existing project: ' + togglEntry.project+' '+togglDate);
                pusher.note(apis.pushbullet.device, 'Toggl Checker', 'Updated: '+togglEntry.project+' '+togglDate);

                sheetRow.description = togglEntry.description;
                sheetRow.hours = togglEntry.hours;
                sheetRow.week = week;
                sheetRow.month = monthYear;
                sheetRow.year = year;

                sheetRow.save();
              }
            }
          });

          // Add new row!
          if( !rowUpdated){
            var newRow = {
              date: togglDate,
              project: togglEntry.project,
              hours: togglEntry.hours,
              description: togglEntry.description,
              week: week,
              month: monthYear,
              year: year,
            };

            newRows.push(newRow);


          }
        }); // each togglRow
      });
    }).then(function(){
      async.eachSeries(newRows, function(row, callback){
        timesheet.addRow(apis.sheets.worksheet_id, row, function(rowOrError){
          console.log('Adding new row: ', row.date, row.project, rowOrError);
          callback();
        });
      }, function(error){
        pusher.note(apis.pushbullet.device, 'Toggl Checker', 'Added: '+newRows.length+' new rows');
        if(error) console.log(error)
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
          console.log('-- Sheets API fail');
          deferred.reject(err);
        } else if(sheet_info && sheet_info.title){
          //console.log( sheet_info.title + ' is loaded' );
          console.log( '-- Sheets API Pass');
          deferred.resolve();
        } else{
          console.log('-- Sheets API fail');
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
