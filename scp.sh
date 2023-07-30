#!/bin/bash

#scp -r package.json package-lock.json tsconfig.json src d0:Projects/Wheatley
rsync -av --checksum db_backup.sh package.json package-lock.json start.sh tsconfig.json indexes src test wiki_articles auth.json d0:Projects/wheatley --exclude={"indexes/cppref/*.txt","indexes/cppref/*cppreference*","*.js"}
#rsync -av -I package.json package-lock.json tsconfig.json cppref src test d0:Projects/Wheatley --exclude={"cppref/*.txt","cppref/*cppreference*"}
