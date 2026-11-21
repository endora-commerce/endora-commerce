---
'@endora-commerce/mod-catalog': patch
---

The attributes screen opens on the list (issues #1527 and #1590). The list has a search over key and labels, a type filter, and *New attribute* in the header. Create and edit open one dialog whose Save is the only save on the screen: the eight checkbox columns and the separate "unsaved flag changes" bar are gone. An attribute's capabilities are edited in the dialog and listed as badges in the row. Labels follow the admin language, value types are named in words, Edit and Delete sit in the row menu, and a deleted row hands focus to its neighbour. Option label inputs and Remove buttons are named "Label for option {value}" and "Remove option {value}" in English and Polish, not by developer ids.
