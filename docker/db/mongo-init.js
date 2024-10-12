

// https://stackoverflow.com/a/68253550
db = db.getSiblingDB('admin');
db.auth("admin", "password");
db = db.getSiblingDB('wheatley');
db.createUser({user:'wheatley', pwd: 'wheatley', roles:[{db:'wheatley', role:'readWrite'}]});
