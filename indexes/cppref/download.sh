#!/bin/bash
regex=".*index\\.php.*|.*/Special:.*|.*/Talk:.*|.*/Help:.*|.*/File:.*|.*/Cppreference:.*|.*/WhatLinksHere:.*|.*/Template:.*|.*/Category:.*|.*action=.*|.*printable=.*|.*en.cppreference.com/book.*" ;
echo $regex ;
wget --adjust-extension --page-requisites --convert-links \
  --force-directories --recursive --level=15 \
  --span-hosts --domains=en.cppreference.com,upload.cppreference.com \
  --reject-regex $regex \
  --timeout=5 --tries=50 --no-verbose \
  --retry-connrefused --waitretry=10 --read-timeout=20 \
  http://en.cppreference.com/w/ ; \

