#!/bin/sh
# Deletes the pre-rename election files left behind after unzipping the ID-rename update over the repo.
cd "$(dirname "$0")/../data/elections" || exit 1
rm -fv class1-sept.json class2-july.json class3-jan.json class4-april.json class4-march.json class5-april.json class5-june.json class5-sept.json class6.json class7-26.json class7-july.json
