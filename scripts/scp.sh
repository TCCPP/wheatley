#!/bin/bash

#scp -r package.json package-lock.json tsconfig.json src d0:Projects/Wheatley
rsync -av --checksum package.json package-lock.json start.sh run-persist.sh tsconfig.json indexes src test wiki_articles auth.json scripts d0:Projects/wheatley --exclude={"indexes/cppref/*.txt","indexes/cppref/*cppreference*","*.js","src/wheatley-private/.git"}
#rsync -av -I package.json package-lock.json tsconfig.json cppref src test d0:Projects/Wheatley --exclude={"cppref/*.txt","cppref/*cppreference*"}
