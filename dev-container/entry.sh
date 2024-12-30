#!/bin/sh

/usr/bin/mongod -f /etc/mongod.conf --logpath /opt/mongo/mongod.log --dbpath /opt/mongo/data &

PORT=27017
TIMEOUT=10
INTERVAL=1
SECONDS_ELAPSED=0

echo "Waiting for mongo to start..."

while [ $SECONDS_ELAPSED -lt $TIMEOUT ]; do
    if netstat -ntlp | grep -q ":$PORT"; then
        echo "Mongo now started"
        break
    fi
    sleep $INTERVAL
    SECONDS_ELAPSED=$((SECONDS_ELAPSED + INTERVAL))
done

if [ $SECONDS_ELAPSED -eq $TIMEOUT ]; then
    echo "Timeout reached while waiting for mongodb, $PORT was never listed in netstat"
    exit 1
fi

mongosh --eval << END
use admin
if (db.getUser("mongoadmin") == null) {
    db.createUser({user:"mongoadmin", pwd: "password", roles:["userAdminAnyDatabase"]})
}
db.auth("mongoadmin", "password")
use wheatley
if (db.getUser("wheatley") == null) {
    db.createUser({user:"wheatley", pwd: "wheatley", roles:[{db:"wheatley", role:"readWrite"}]})
}
END

npm i

exec /bin/bash
