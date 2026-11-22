---
'@endora-commerce/mod-returns': patch
---

**Returns: reasons and statuses take a Polish name, not only an English one.** The *Return reasons* and *Return statuses* screens now have one name field per language, English and Polish, when you create a reason or status. Either name is enough. Each row also has an *Edit* action, which opens the same dialog to change its names. Editing keeps any other language the record already stores. A status's default name and its suggested code come from the English name, or from the Polish one when there is no English name. The list shows a "Missing: …" badge on a row that lacks a language. The API and the stored data are unchanged.
