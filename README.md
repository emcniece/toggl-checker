#Toggl Checker

Checks a Toggl account and adds entries to a Google Sheet when new activity is detected!

Requires a Toggl API key, and a Google Apps application that has access permission to the target spreadsheet.

Setup:

1. Follow **Setup Instructions** at https://www.npmjs.com/package/google-spreadsheet for creating a Drive API signature
1. Edit `index.js` and update the following credentials:
    - `var gcreds = require('./Eric-Toggl-Worklog-Updater-8965f1889488.json');`
    - `apis.toggl.key, user_agent, workspace_id`
    - `apis.sheets.id, worksheet_id`
1. Run: `node index.js` or `supervisor index.js`

Reference:
    - [Toggl API](https://github.com/toggl/toggl_api_docs/blob/master/toggl_api.md)
    - [Toggl Reports API](https://github.com/toggl/toggl_api_docs/blob/master/reports.md)
    - [Promised-IO](https://github.com/kriszyp/promised-io)
    - [Restler](https://github.com/danwrong/restler)
    - [Dateformat](https://www.npmjs.com/package/dateformat)
    - [Time](https://www.npmjs.com/package/time)
    - [Google Spreadhseet](https://www.npmjs.com/package/google-spreadsheet)