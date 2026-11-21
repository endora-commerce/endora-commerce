---
'@endora-commerce/mod-forms': patch
---

The form builder says which settings apply at once (issues #1512 and #1539). The Retention section on the Settings tab and the Shop notification section on the Notifications tab, which save on their own, now carry the "Applies immediately" badge on their headings; every other section is saved and published with the Save and Publish bar. The sentences that used to explain this in prose are removed, the section descriptions and field hints are cut to one line each in English and Polish, and the result of a section's own save appears beside its button. The content-language bar above the tabs is a plain row divided from the tabs by a rule instead of a separate card, and its untranslated-text marks use the warning colour of the theme.
