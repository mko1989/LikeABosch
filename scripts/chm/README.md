# CHM tools (WO-044)

The vendor ships newer docs as Windows HtmlHelp (`.chm`). They are plain compressed HTML:

```
7zz x -y -odocs/source/chm/ConferenceProtocol docs/source/ConferenceProtocol.chm   # brew install sevenzip
python3 scripts/chm/chmtext.py ConferenceProtocol "History" "ReadNotesFile Method"  # topic → text
python3 scripts/chm/chmdiff.py                                                      # CHM vs operations/*.json
```

Python 3 standard library only (these are one-off documentation tools, not part of the app).
