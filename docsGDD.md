# **GAME DESIGN DOCUMENT**

# **Projekční koncept hybridní real-time strategie**

---

# **1\. Základní vize a parametry hry**

Tento projekt kombinuje dynamický průběh hraní s hlubokým takticko-strategickým rozhodováním. Klade si za cíl propojit plynulé zabírání území známé z *OpenFront* s rozsáhlými možnostmi výzkumu, stavby a mikro-manažmentu specializovaných jednotek z *Call of War*. První testovací mapa je zasadena do prostředí Evropy (obsahuje hory, nížiny, poloostrovy i ostrovy pro důkladné ověření terénní průchodnosti, námořního zásobení i leteckých operací).

* **Herní koncept:** Strategická real-time hra propojující rychlou frontovou expanzi a zjednodušenou mikro-kontrolu specifických bojových složek.  
* **Cílová délka partie:**  
  * **Standardní režim:** 35–45 minut, případně i delší partie (klidně kolem 90 minut), pokud hra zůstane přehledná a takticky čitelná. Ponechává se rozumné, čitelné tempo bojů a frontových střetů bez plošného a slepého zrychlování, protože po přidání taktických jednotek, obran a Tech Tree by příliš rychlý průběh bitvy vedl ke zmatku a přehlcenosti. Místo zrychlování bojů se upřednostňuje rozumné vyvážení a využití testovacího speed-upu pro simulaci.  
  * **Rychlý režim (plánováno):** 15–20 minut (zjednodušený výzkum, zrychlené posuny fronty).  
* **Počet účastníků:**  
  * Maximální kapacita mapy: **20 hráčů**.  
  * Optimalizovaný stav pro standardní zápas: **4–12 hráčů** (doplněno o AI boty do plného stavu).  
* **Herní režimy:**  
  * **Singleplayer:** Tréninkové zápasy a scenáristické bitvy proti přizpůsobitelným AI botům.  
  * **Multiplayer:** Lobby systém, veřejné a soukromé partie, kooperativní zápasy proti AI.

---

# **2\. Herní tempo a ovládání (Hybridní model)**

## **Tempo hry**

Hra využívá **zpomalený real-time systém**. Na rozdíl od extrémně rychlých klikacích strategií je celková rychlost posunu fronty a výroby upravena tak, aby hráči měli dostatek času na:

1. Vyhodnocení strategické situace na více bojištích současně.  
2. Správu ekonomiky a plánování technologického stromu.  
3. Koordinaci kombinovaných útoků (pozemní, letectvo, námořnictvo).

## **Kombinovaný systém řízení bojů**

| Složka ovládání | Mechanika a funkce | Typické použití |
| :---- | :---- | :---- |
| **Frontová expanze** | Kreslení směrů útoků (vektorové šipky) po hranicích. Automatický tlak pěchotních linií. | Hlavní zabírání území, udržování souvislé linie defensive/offensive. |
| **Specializované jednotky** | Ruční ovládané taktické figurky pohybující se volně po mapě. | Průlom fronty, průzkum, přesné obchvaty, taktika hit-and-run. |

* **Frontový útok (Šipka) a mobilizace:** Místo nejasného globálního procenta z celé říše má hráč mobilizovanou sílu v lokálních shromaždištích a zónách podél hranic či měst. Útočné šipky čerpají síly z těchto zón. Je k dispozici také výsadek parašutistů hloubbi do týlu, kteří dokáží obsadit klíčové body a otevřít nové směry tlaku, zatímco síly vyslané na mise nejsou dočasně dostupné jinde. **Zakřivené / ohýbatelné útočné šipky (spline / waypoint křivky), statické zobrazení směru a přesné směrování:** Hráč může útočnou šipku při kreslení nebo úpravě ohýbat/zakřivovat (přes plynulé tažení trasou nebo zadávání klikacích waypoint bodů jako přesné alternativy), což umožňuje obchvaty hor, obcházení opevněných linií, klešťové manévry a obkličování nepřátelských výběžků. Prozatím se ponechá plynulé tažení (tah) s tím, že se vyladí jeho stabilita. Šipka musí při útoku působit statičtěji a jasně ukazovat nastavený směr bez nežádoucího „kordlování“ či cukání při posunu fronty, s možností plnohodnotných klikacích bodů v budoucnu. Expanze musí přísně sledovat konkrétní směrování šipky/trasy a zamezit nekontrolovanému plošnému sesouvání či posunu celé fronty do stran, kam šipka nemíří. **Ošetření dlouhých útočných šipek:** Při natažení šipky na příliš dlouhou vzdálenost docházelo v simulačním enginu k přechodnému zaseknutí (zbytkový Manpower 1–5 vojáků zůstal blokován v útoku, šipka nesmazána, fronta nehybná). Engine musí obsahovat pevný časový a vzdálenostní limit trvání šipky, po jehož vypršení nebo zablokování dojde k čistému ukončení operace a okamžitému navrácení zbývajícího Manpoweru do aktivní zálohy.  
* **Napojení specializovaných jednotek na šipku a chování na konci útoku:** Tanky, dělostřelectvo a podpora se dají kliknutím přiřadit ke konkrétní útočné šipce. Po skončení útočné šipky zůstávají jednotky primárně na místě (s možností ručního přesunu, opravy na místě pomalejším tempem nebo návratu k opravárenskému bodu).  
* **Samostatné cílení a částečná mlha války (Fog of War):** Letectvo a námořnictvo mohou fungovat v dosahu na konkrétní cíle. Přesné počty a pohyby nepřátelských jednotek a detailní obrany nejsou vidět po celé mapě; odhalují se blízkostí hranic/jednotek, průzkumem, radary či loděmi/letadly s příslušným dosahem a vylepšeními (např. odhalení pobřežní PVO lodí s radarem pro následný nálet).  
* **Obranné mechaniky, ústup/obklíčení, energetická izolace, okamžitá anexe a zajmutí/kořistění:** Opevnění, zákopy, protitankové zábrany a systémy PVO výrazně brzdí a poškozují útočné šipky i samostatné taktické jednotky. Budování obran vyžaduje stavební materiál a Manpower; jejich přítomnost znásobuje obranný koeficient daného sektoru. Když nepřítel zabere území pod jednotkou, jednotka nezmizí automaticky bez boje, ale nadále se brání a způsobuje útočníkovi ztráty podle síly a typu střetu. Jednotka nemůže utéct skrz nepřátelské území bez vybojování cesty ven – zůstává uvězněna v ohnisku, dokud se neprobojuje nebo ji nevysvobodí posily zvenčí. Oddělené či obklíčené jednotky v nepřátelském území nemají přísun energie/zásobování, postupně slábnou a rozpadají se. **Pravidlo obklíčení a anexe:** Pokud obklíčená oblast bez jednotek a budov sousedí s vodou, jiným hráčem/státem nebo s hranou mapy, NESMÍ být automaticky anektována; pokud je však obklíčena kdekoliv jinde (čistě uzavřena souvislým územím jednoho hráče bez kontaktu s vodou, třetí stranou či hranou mapy), dochází k okamžité anexi. Ostrovy vlastněné státem sdílejí energii v rámci jednoho státu pro zachování přehlednosti a hratelnosti. Při porážce obklíčené taktické jednotky hráč automaticky získá určitý loot/zdroje; pokud má odemčený příslušný upgrade v tech tree, může jednotku i zajmout a převzít pro sebe.  
* **Start partie (Výběr startovní pozice po vzoru OpenFront):** Hráči si kliknutím na mapu vyberou startovní pozici. Vidí hranice a velikost území ostatních států, ale nevidí jejich detailní vnitřní vývoj, postavené budovy, úrovně upgradů, složení jednotek ani stav Manpoweru (dokud to neodhalí průzkum/špionáž/výzkum). Po startu se automaticky založí hlavní město s počátečním územím, základním příjmem peněz, Manpowerem, základem stavebního materiálu a možností postavit první elektrárnu zdarma (free startovní budova pro rozjezd energetické rezervy).  
* **Expanze na volné území (Wilderness), ohraničení střetů a strategie útočných šipek:** Kreslení útočných šipek zabírá okolní neobsazené území (wilderness) i nepřátelské hranice. Expanze do wilderness a souboje na hranicích cizích států mají přísně definovaná teritoriální ohraničení a soubojovou logiku – útočná linie nemůže bezhlavě pronikat přes cizí území bez vyřešení hraničních střetů a rozbití obranné infrastruktury. Platí přísné čitelné oddělení expanze do wilderness a útoku na cizí stát (ochrana proti nechtěnému „fightění“): i když je hráč se sousedem ve válce, při tažení šipky do wilderness nemá automaticky útočit na soupeře, pokud cíleně nezvolí či nepotvrdí útok na daný úsek či území (včetně možnosti kliknutí na úsek fronty pro cílený útok a double-kliknutí pro plný OpenFront nápor nejbližších sil). Umožňuje se kliknutím označit/zvýraznit konkrétní cíl (ať už jde o wilderness nebo konkrétní stát/úsek) pro cílený útok s možností se po odkliknutí vrátit k běžnému ovládání. Při double-tapu / plném náporu i běžném šíření fronty se území musí vyplňovat organicky a plynule ze všech přilehlých směrů a podél obklíčení směrem ke kliknutému cíli (po vzoru OpenFront), nikoli v nepřirozených pravidelných čtvercích či obdélnících. Zároveň je při náporu zajištěno čisté doražení a automatické odstranění drobných zbytkových „teček“/kapes soupeře. Při tažení šipky z vlastního území přes obklíčený cizí stát či území soupeře zpět na jiné vlastní území se nesmí rozbít zdroj/počátek útoku ani dojít k mrtvému/nefunkčnímu stavu nebo deformaci směru – šipka musí mít jasně definovaný bod/zdroj vzniku a při návratu nad vlastní území fungovat korektně bez rozbití směru. Výběr úseku fronty se po posunu hranice musí automaticky čistit a nesmí zůstávat viset „ve vzduchu“ na místech, kde již hranice není. Rychlost postupu útočné šipky a celkové tempo dobývání jsou nastaveny svižněji (cca 1.6×–2.0× oproti původnímu stavu) a jsou přímo ovlivněny množstvím nasazeného Manpoweru – vyšší nasazený Manpower zrychluje postup do wilderness i přes hranice. Terén (např. hory vs. nížiny) výrazně zpomaluje postup fronty a omezuje průchodnost těžké techniky. Hráči mají navíc možnost odemykat v tech tree a doktrínách různé profily/strategie útočných šipek (např. užší, průbojnější šipku pro rychlý hluboký průnik vs. širší, pomalejší postup pro plošné zajištění území). Hráč může kromě běžných útočných šipek označit konkrétní část své fronty či vytvořený výběžek a určovat směr tlaku (doleva/doprava/střed/ven) pro taktické uzavírání kapes.  
* **Rozložení Manpoweru, mobilizace a obsazenost budov:** Místo složitých zón, kroužků nebo „fluidu“ vojáků po hranicích se Manpower spravuje přes posuvníky či procentuální alokaci – pro každý typ budovy (např. továrny, laboratoře, letiště, přístavy, kasárna) zvlášť, případně individuálně u konkrétní budovy, s možností centrálního ovládání pro rychlé přepnutí (např. 100 % do optima). Zbývající aktivní Manpower je k dispozici pro útoky (útočné šipky) a obranu napříč celým státem. Když hráč pošle např. 50 % aktivního Manpoweru do útoku na jedné straně, zbytek aktivního Manpoweru je slabší i na jiných směrech (přičemž lidé vázaní v provozu budov se do útočné šipky nepočítají). Ostatní hráči nevidí přesný rozpad alokace Manpoweru soupeře, pokud to nezjistí např. přes výzkum či špionáž.  
* **Překonávání vodních ploch, lodě a námořní přeprava:** Přesun pozemních sil a útočných šipek přes moře, vodní plochy či podél pobřeží na ostrovy vyžaduje využití přístavů a plavidel. K dispozici jsou jak jednoduché neozbrojené přepravní lodě (transporty lidské síly), které lze snadno sestřelit/zničit pobřežní obranou a ostřelováním, tak pokročilejší bojové a výsadkové lodě z přístavu. Dále se zvažuje možnost realizace námořních i pozemních obchodních trasa (trade routes) pro výměnu surovin.  
* **Vyhlášení války, mír, varování, přímý Ambush a vzájemná reakce na útok bota:** Útok na cizí stát se nesmí spustit omylem jen proto, že hráč potáhne šipku u hranice nebo přes území soupeře při běžném směrovém tahu. Válku lze vyhlásit dvěma spolehlivými způsoby: (a) přes kontextový profil státu (kliknutím pravým tlačítkem na stát na mapě i kliknutím v leaderboardu) s plně funkčním tlačítkem/akcí „Vyhlásit válku“, mír, alianci a od Kroku 3 i vzájemný automatický obchod mezi sousedy po vzoru OpenFront, nebo (b) přímým útokem ze zálohy (Ambush) podržením útočné šipky nad neutrálním státem po dobu 2–3 sekund s vizuálním odpočtem. Pokud AI bot vyhlásí válku nebo začne útočit na hráče, stav/vztah WAR se okamžitě stává obousměrným a plně aktivním i pro hráče, takže hráč není zablokován v nemožnosti útočit zpět na bota, který na něj útočí. Pokud hráč při tažení šipky přes wilderness přejede špičkou na neutrální stát a pustí tlačítko dřív (nebo chce jen vytyčit směr), provede se běžný útok/expanze daným směrem bez spuštění Ambush války, dokud se plně nenaplní časová podmínka odpočtu. Po vyhlášení války lze konflikt následně ukončit uzavřením míru skrze kontextový profil.  
* **Prevence čistého „OpenFront / Territorial.io“ rushování bez ekonomiky a Tech Tree:** Hra nesmí odměňovat slepé přetlačování čistě přes počet buněk a surový Manpower bez investice do ekonomiky, budov a technologického stromu (Tech Tree). Místo přímé penalizace samotných útočných šipek za absenci měst dává větší smysl, aby prázdné území / wilderness neposkytovalo dostatečné množství Manpoweru samo o sobě – hráč tak musí reálně budovat zázemí (města, doly, elektrárny), aby měl dostatek sil na dlouhodobé vedení bojů. Při navrhování obsazení mapy se zvažuje přiměřený počet hráčů a botů, aby se hra nezměnila jen v bezduché naklikávání a boj bez budování infrastruktury.  
* **Koalice / aliance, rozhodování botů a tresty za porušení aliance (betrayal):** Hráči a AI mohou tvořit aliance/koalice, ve kterých se vzájemně nenapadají. AI boti nesmí přijímat aliance příliš snadno ani působit jednoduše; je vyžadováno chytřejší a opatrnější rozhodování botů (lepší vyhodnocování fronty, cílů, aliancí a relativní síly), které bude detailně laděno ve vyhrazeném kroku vývoje. Pokud někdo alianci poruší a zaútočí na spojence, uplatní se okamžitý bojový debuff pro zrádce (nepřátelé proti němu bojují snáz) a finanční sankce, což dělá z diplomacie reálnou sázku.  
* **Přehled států / leaderboard a barevné odlišení vztahů:** V seznamu států / leaderboardu budou zřetelně odlišeny diplomatické a bojové vztahy – např. červeně státy, se kterými je hráč ve válce, a zeleně státy, se kterými je v alianci, aby měl hráč okamžitý přehled, s kým bojuje a s kým spolupracuje.

---

# **3\. Ekonomika a suroviny**

Ekonomika stojí na šestici surovinových pilířů, přičemž veškerá lidská pracovní i vojenská síla je sjednocena pod zdroj Manpower. Pro zachování přehlednosti a hratelnosti platí limit nákladů na položku: žádná budova ani jednotka nevyžaduje pět různých surovin najednou – cílem jsou maximálně 2–3 různé nákladové složky (u nejtěžších jednotek max. 3). Budovy se nacházejí na plynulé pixelové mapě v regionálních spotech. Vyvážení tempa hry a ekonomiky je navrženo tak, aby hra nebyla chaotická a umožňovala promyšlená taktika rozhodování i v delších zápasech (až cca 90 minut). Zároveň platí zásada prevence čistého rushování bez ekonomiky a výzkumu: hra zamezuje bezhlavému zabírání území bez budování infrastruktury, neboť nepodložená expanze naráží na limity v produkci, energii a technologické zaostalosti vůči připravenému soupeři.

## **Pilíře ekonomiky**

1. **Peníze (Finance)**  
   * *Zdroj:* Zdanění obsazených území, města a finanční centra.  
   * *Využití:* Uplatňují se napříč celou ekonomikou – zejména pro nákup a verbování jednotek, obchod na burze, kombinaci nákladů u stavby budov a náročné pokročilé výzkumy v tech tree (aby nebylo možné snadno odemknout všechny větve naráz bez silné ekonomiky a jasné strategie/doktríny). Zachovává se limit maximálně 2–3 různých surovinových složek u nejtěžších položek.  
2. **Znalosti (Knowledge / Výzkum)**  
   * *Zdroj:* Laboratoře, knihovny a výzkumná střediska v krajských městech. Získané znalosti se při zničení budov neztrácejí.  
   * *Využití:* Slouží výhradně k odemykání uzlů v technologickém stromu (tech tree) a financování progresu vědeckého cíle; neutrácí se jako spotřební komodita na běžné stavby.  
3. **Stavební materiál**  
   * *Zdroj:* Doly, kamenolomy a lehké továrny.  
   * *Využití:* Základní stavby (města, vesnice, infrastruktura, opevnění) v kombinaci s penězi a základním materiálem.  
4. **Průmysl**  
   * *Zdroj:* Zbrojovky a továrny lehkého i těžkého průmyslu.  
   * *Využití:* Těžší budovy a výroba či modernizace lodí, tanků, letadel a zbraní.  
5. **Ropa / Energie**  
   * *Zdroj:* Ropná pole, rafinérie a elektrárny.  
   * *Využití:* Slouží k udržení provozu budov a jednotek. Energie/ropa má plynulý přísun z elektráren/zdrojů a ukládá se do energetické zásoby (rezervy), pokud produkce převyšuje spotřebu. Při výpadku elektráren nebo poklesu produkce pod spotřebu se nejprve čerpá z této rezervy. Jakmile zásoba klesne na nulu, nastává kritický energetický deficit / výpadek (blackout) s výrazným varováním v UI. Systém spustí postupný pokles výkonu továren a budov (až po úplné odstavení při trvající nule), oslabování bojových jednotek a postupný úbytek Manpoweru ve městech, což dává hráčům čas krizi řešit. Budovy ani města se při výpadku energie fyzicky nerozpadají ani nemizí (lze je po obnovení energie znovu zprovoznit nebo je může obsadit a zprovoznit nepřítel). Po obnovení dodávek energie se obnova budov, výkonu i Manpoweru rozbíhá postupně, nikoli okamžitě.  
6. **Vojáci (Manpower)**  
   * *Zdroj:* Obnovující se lidský potenciál na území a v sídlech. Růst Manpoweru má neviskózní křivku s definovaným optimem – růst začíná pozvolna, zrychluje směrem k ideálnímu optimu populace/kapacity a za ním postupně zpomaluje až stagnuje. Tempo růstu Manpoweru i rychlost zabírání wilderness jsou nastaveny tak, aby umožňovaly svižnější budování armády a dynamickou expanzi, přičemž finální balanc se přizpůsobuje náročnosti budov a Tech Tree v rámci 35–45minutové partie. Součástí systému je obranná a regenerační pojistka zabraňující permanentnímu vyčerpání a „death spiralu“ Manpoweru při útoků více soupeřů najednou, aby hráč neuízl trvale na minimálním Manpoweru (např. kolem 5 z 8 000\) bez možnosti se bránit nebo zotavit.  
   * *Využití:* Neplatí se jím jako běžnou spotřební komoditou – představuje lidi/vojáky připravené k operativnímu nasazení v boji (útočné šipky, obrana) a k obsluze a provozu budov či továren.

## **Tržiště / Burza (Trade)**

Hráči mají k dispozici automatickou burzu a obchod se základními kurzy, které dynamicky reagují na poptávku (zdražování při vysoké poptávce brání nekonečnému zneužívání směn). Dále jsou k dispozici automatické časované mise (výprava části vojáků mimo domov na předem daný čas s rostoucí odměnou/lootem při větším nasazení, vyžadující minimální práh sil proti early-game exploitům, za cenu dočasného oslabení domácí obrany).

## **Fyzické budovy na mapě a typ mapy**

Na plynulé/pixelové mapě budovy zabírají reálný prostor bez pevných předkreslených slotů. Pro zajištění plynulosti a odstranění hrubého "kostičkovaného" dojmu je mapa navržena ve větším měřítku a vyšším pixelovém rozlišení odpovídajícím kapacitě až 20 hráčů. Vizuál mapy je zjemněný a vyhlazený pro estetický vzhled bez pixelace. Hráč volí přesné umístění budov s ohledem na riziko ostřelování a celkový prostor. Budovy lze dále vylepšovat skrz Tech Tree.

7. **Surovinové zóny (kruhy s nevystředěným optimem), absence kruhu a skrývání zdrojů:** Základní zdroje (stavební materiál, základní energie) jsou vidět od začátku v podobě kruhových oblastí s nevystředěným optimem. Na mapě je generován vyšší počet základních kruhů pro energii i stavební materiál, aby měl přibližně každý hráč možnost využívat zónu u zdroje a nemusel soupeřit o ojedinělé oblasti na celé mapě. Pokud hráč startuje nebo expanduje mimo kruh energie či stavebního materiálu, budova poskytuje pouze nižší základní výkon/výtěžnost (např. cca 20–50 % podle suroviny), což brání kompletnímu paralyzování vývoje, ale udržuje omezený režim. Naopak stavba uvnitř zón zvyšuje výkon až k 100 %, čímž si kruhy zachovávají vysokou strategickou hodnotu pro těžbu a energetiku. Pokročilé / těžké materiály se odhalují buď zobrazením velkých přibližných zón/kruhů hned od začátku (které se postupně zpřesňují), nebo až po jejich odemčení v technologickém stromu (tech tree) a následném zpřesňování. Manpower se rozkládá mezi městy a zázemím, přičemž doly a elektrárny plynule dodávají své suroviny pro fungování říše.  
8. **Přetížení těžebních a energetických budov v zónách:** Hráč může posuvníkem zvýšit obsazenost budovy až na 200 % Manpoweru. Lokace Manpoweru na 200 % přináší buff \+20 % k výkonu (dosahuje tedy 120 % výkonu dané lokality), ale při snížení celkové efektivity přepočtu energii/surovin (např. jen 80 % reálné energetické výtěžnosti oproti optimálním 100 % obsazenosti). Výkon uvnitř zóny v kombinaci s přetížením tak může dosáhnout až 120 % celkového výkonu. Pokročilé elektrárny/zdroje z vyšších úrovní tech tree mají vyšší základní efektivitu a menší závislost na poloze ložiska.  
9. **Rare looty / speciální nálezy na mapě a dynamické zóny:** Při obsazování území/wilderness se vyskytují zóny s procentuální šancí na speciální nálezy (rare looty – bonusové suroviny, peníze, zrychlení výzkumu). Na začátku partie nejsou přesně vidět nebo mají pouze velkou přibližnou oblast, která se s pokrokem v tech tree, vylepšením konkrétních budov nebo průzkumem postupně zmenšuje a zpřesňuje. Rozmístění těchto nálezů se v každé partii mění, aby se předešlo šablonovitému hraní. Reálná procentuální efektivita daného místa se hráči finálně odhalí až po postavení příslušné budovy, přičemž tyto citlivé údaje podléhají autoritě serveru a nejsou předčasně odhalitelné přes F12 / DevTools v prohlížeči.  
10. **Města:** Zdroj příjmů z daní a základní alokace Manpoweru.  
11. **Továrny & Rafinérie:** Průmyslová výroba materiálů, zbraní a ropy.  
12. **Laboratoře / Knihovny:** Generování Knowledge.  
13. **Kasárna:** Verbování a výcvik jednotek.  
14. **Letiště a Přístavy:** Nevyhnutelné pro stavbu a operace letectva a loďstva.

Ztráta budovy reálně omezí produkci nebo provozování příslušného typu jednotek (vyjma již vyzkoumaných technologií).

## **Přehled budov a jejich ekonomická role v 35–45 min partii**

Budovy jsou navrženy tak, aby zapadaly do tempa zápasu a vyžadovaly kombinaci max. 2–3 surovinových složek:

15. **Město / Správní centrum:** Generuje Peníze z daní a určuje kapacitní strop pro růst Manpoweru k jeho optimu. Náklady: Stavební materiál \+ Peníze. Spotřeba: Ropa/Energie (udržení provozu).  
16. **Důl / Kamenolom:** Produkuje Stavební materiál pro infrastrukturu a základní stavby. Náklady: Peníze \+ Manpower. Spotřeba: Základní Energie.  
17. **Elektrárna / Rafinérie:** Generuje Ropu a Energii do zásoby pro provoz říše. Náklady: Stavební materiál \+ Peníze. Spotřeba: Manpower.  
18. **Zbrojovka / Těžký průmysl:** Produkuje Průmysl a umožňuje výrobu tankové i dělostřelecké techniky. Náklady: Stavební materiál \+ Peníze. Spotřeba: Energie \+ Manpower.  
19. **Laboratoř / Výzkumné středisko:** Generuje Znalosti (Knowledge) pro posun v Tech Tree a vědecké vítězství. Náklady: Peníze \+ Průmysl. Spotřeba: Energie \+ Manpower.  
20. **Kasárna / Výcvikové středisko:** Umožňuje verbování a modernizaci pěchotních sil. Náklady: Stavební materiál \+ Peníze. Spotřeba: Manpower.  
21. **Přístav & Letiště:** Nezbytné pro stavbu/operace loďstva a letectva a realizaci zámořských výsadků. Náklady: Stavební materiál \+ Průmysl \+ Peníze. Spotřeba: Energie \+ Manpower.

---

# **4\. Technologický strom (Tech Tree)**

Technologický strom je rozdělen do **5 specializovaných větví**. Každý národ či hráč se může zaměřit na jinou doktrínu (např. blesková pozemní válka vs. námořní dominance).

## **Větve výzkumu**

* **Pozemní armáda:** Vylepšení pěchoty, lehkých a těžkých tanků, protitankového vybavení.  
* **Dělostřelectvo a podpora:** Zvýšení dostřelu, přesnosti, mobilní protivzdušná obrana, inženýrské jednotky.  
* **Letectvo:** Stíhačky pro nadvládu ve vzduchu, taktické a strategické bombardéry, průzkumná letadla.  
* **Námořnictvo:** Křižníky, ponorky, letadlové lodě a výsadková plavidla.  
* **Ekonomika a infrastruktura:** Zvýšení efektivity těžby surovin a dopravy.  
* **Obranné technologie a posílení armády:** Výzkum a stavba zákopů, minových polí, protitankových zátarasů, děl a obranných prvků na hranicích, systémy protivzdušné obrany (PVO) a postupné posilování armády (např. výzkumy zvyšující udílené poškození nebo snižující utrpěné ztráty v bojích).

## **Systém úrovní (Levelování)**

Každá jednotka má několik úrovní (Level 1–5). Zvýšení úrovně přináší různé benefity:

* **Level 1 (Základ):** Dostupné standardní jednotky od začátku hry.  
* **Level 2–3 (Modernizace):** Zvýšení poškození, odolnosti a rychlosti pohybu.  
* **Level 4–5 (Elitní úroveň):** Speciální schopnosti (např. kamufláž, prodloužený dostřel, pasivní aura pro okolní frontu).

---

# **5\. Stav projektu a plán vývoje**

Vývoj je rozdělen do tří hlavních fází s cílem doručit včas hratelný prototyp a postupně rozšiřovat funkcionalitu.

## **Detailní modulární plán vývoje (Road Plan Krok 1 – 10\)**

*Poznámka k vizuálu, skinům a UI/UX:* Základní čistá a přehledná kartografie mapy i funkční HUD se zpřesňují už v průběhu vývoje (zejména v Kroku 2 a při zavádění budov, jednotek a tech tree), aby šla hra dobře číst a testovat. Detailní finální grafika, skiny jednotlivých typů jednotek/budov a celkové uhlazení UI/UX se však řeší až poté, co bude herní jádro a většina mechanik technicky fungovat a budou doladěné hlavní systémy (především v závěrečné fázi projektu, resp. v Kroku 10 a návazném poladění rozhraní).

- [ ] **Krok 1 (HOTOVO v základu – vyžaduje opravy v Kroku 2): Základní kostra, mapa Evropy a fronta**  
  - [ ] **Moduly:** src/engine/types.ts, src/engine/mapGenerator.ts, src/engine/frontExpansion.ts, src/engine/simulation.ts, src/engine/bots.ts, src/render/camera.ts, src/render/canvasRenderer.ts, src/ui/hud.ts.  
  - [ ] **Obsah a stav:** Oddělená simulace od renderu (příprava na serverovou autoritu), výběr startovní pozice, základní expanze do wilderness přes šipky a výběr úseku fronty, 7 AI botů.  
- [ ] **Krok 2 (AKTUÁLNÍ PRIORITA): Oprava jádra simulace, větší mapa, křivka Manpoweru, vizuální čistota, ladicí nástroje a bezpečnostní/diplomatický balík**  
  - [ ] **Dotčené moduly:** src/engine/mapGenerator.ts, src/engine/frontExpansion.ts, src/engine/simulation.ts, src/render/canvasRenderer.ts, src/ui/hud.ts.  
  - [ ] **1\. Plynulejší, zjemněný a vyhlazený vzhled mapy Evropy a zvětšení mřížky:** Zachování simulační mřížky 720×500 pro plynulé FPS, ale v renderu odstranění kostičkovaného/pixelovaného vzhledu a fluidní vykreslování mapy (hladké přechody a kontury bez pixel-art efektu) s využitím jemného antialiasingu a čistších vektorových detailů pro dosažení estetického vzhledu při zachování vysokého výkonu pro až 20 hráčů.  
  - [ ] **2\. Oprava zaseknutí dlouhých šipek a zakřivené trajektorie:** Implementace zakřivených trajektorií šipek s pevným časovým a vzdálenostním limitem trvání, ochranou proti stagnaci, automatickým čistým ukončením operace a vrácením zbývajícího Manpoweru do aktivní zálohy.  
  - [ ] **3\. Přísné rozlišení hranic a návazný doplňující balík ochrany:** Rychlá expanze do wilderness vs. zpomalený hraniční střet se soupeřem (zabezpečení proti bezhlavému přelévání přes cizí stát bez vyřešení hraničních bojů). Implementace přesnější ochrany hranic před nechtěným bojem a potvrzení vyhlášení války/míru.  
  - [ ] **4\. Zrychlení a nelineární křivka Manpoweru a expanze:** Doladění nelineární křivky růstu vojáků kolem optima a zrychlení záboru wilderness pro plynulejší a svižnější budování armády i tempo hraní v 35–45minutovém zápasu.  
  - [ ] **5\. Přepracování vizuálu mapy, kartografie, HUD a diplomacie:** Přepracovaná čistá kartografie, ostré hranice, čitelné štítky a profesionální HUD bez AI slopu. Zapojení aliancí/koalic se sankcemi za porušení a barevně odlišený leaderboard (červeně válka, zeleně aliance).  
  - [ ] **6\. Statické útočné šipky s plynulým tahem / waypointy, přesným směrováním a ochranou proti nechtěnému útoku:** Implementace tažení i trasy pomocí klikacích waypoint bodů v src/engine/types.ts, src/engine/frontExpansion.ts a renderu. Zajištění statičtějšího zobrazení šipek bez cukání, plynulého a stabilního tahu a striktního oddělení expanze do wilderness od nechtěného napadení sousedního státu (zobrazení varování a vyžadování potvrzovacího kroku / UI interakce pro vyhlášení války). Zabezpečení přesného sledu trasy tak, aby nedocházelo k nežádoucímu plošnému sesouvání celé fronty mimo směr šipky. Automatizované ověřování chování šipek pomocí AI/testovacích skriptů.  
  - [ ] **7\. Ladicí a testovací prvky v UI, časovač partie a surovinové zóny:** Přidání časovače trvání partie ve formátu MM:SS, ovladače zrychlení času/simulace s možnostmi zrychlení až na 50x (např. 1x, 2x, 5x, 10x, 50x speed-up) pro efektivní testování ekonomiky a generování více základních kruhů surovin po mapě.  
  - [ ] **8\. Zapojení nástrojů Antigravity (Graphify, Caveman, PonyTail):** Využití instalovaných doplňků pro udržitelnou správu kódové základny, mapování závislostí a úsporu kontextových tokenů při plnění kroku 2\.  
- [ ] **Krok 2B (Navazující sprint): Zapracování kompletního balíčku mechanik a UI**  
  - [ ] **Dotčené moduly:** src/engine/frontExpansion.ts, src/engine/simulation.ts, src/render/canvasRenderer.ts, src/ui/hud.ts, src/ui/leaderboard.ts.  
  - [ ] **Rozsah sprintu Krok 2B:** 2s Ambush s vizuálním odpočtem \+ pravoklikový profil státu na mapě i v leaderboardu, aliance s bojovým debuffem za zradu, barevně odlišený leaderboard, časovač partie ve formátu MM:SS \+ speed-up simulace (1x–50x), zrychlené tempo Manpoweru a záboru wilderness, statická útočná šipka bez cukání s přesným sledováním trasy, generování více základních kruhů surovin po mapě a fluidní render mapy bez pixel-art efektu.  
  - [ ] **Nové / upravené moduly:** src/engine/economy.ts, src/engine/buildings.ts, src/ui/buildMenu.ts, src/ui/manpowerPanel.ts.  
  - [ ] **1\. Kompletní ekonomika surovin:** Peníze, Knowledge, Stavební materiál, Průmysl, Ropa/Energie, Manpower (s přísným limitem max. 2–3 složky nákladů na položku).  
  - [ ] **Zpětná vazba a chyby z testování Kroku 2B:** Vyhlazená mapa působí rozmazaně (efekt rozostřených pixelů); šipky vykazují chyby při přejezdu přes obklíčený stát zpět na vlastní území, dochází k nechtěnému plošnému sesouvání fronty a bugování animací botů na 10x rychlosti i po jejím vypnutí; při expanzi do wilderness dochází k nechtěnému hitování soupeře ve válce; označený úsek fronty zůstává viset ve vzduchu po posunu hranice; grafický vzhled leaderboardu vyžaduje přepracování (zatímco rozklikávací profil státu pro mír/info funguje správně).  
- [ ] **Krok 2C (Stabilizační a ladicí sprint): Oprava chování šipek, animací botů, čištění fronty, anexe kapes a doostření renderu**  
  - [ ] **Dotčené moduly:** src/engine/frontExpansion.ts, src/engine/simulation.ts, src/engine/bots.ts, src/render/canvasRenderer.ts, src/ui/hud.ts, src/ui/leaderboard.ts.  
  - [ ] **1\. Doostření vykreslení mapy:** Odstranění efektu rozmazaných pixelů v renderu a zajištění ostrého, čistého zobrazení terénu a hranic bez ztráty výkonu.  
  - [ ] **2\. Stabilizace šipek a počátku útoku:** Pevné ukotvení zdroje šipky při přejezdu přes obklíčené území zpět na vlastní stát, zamezení obrácení či deformaci šipky a eliminace plošného sesouvání fronty mimo směr tahu.  
  - [ ] **3\. Oprava animací AI botů a rychlosti simulace:** Korektní reset časování a animací botů po přepnutí z 10x speed-upu zpět na normální rychlost.  
  - [ ] **4\. Okamžitá anexe obklíčených kapes a automatické čištění výběru fronty:** Okamžité převzetí prázdného obklíčeného území bez jednotek/budov a automatické odstraňování zvýraznění úseku fronty, pokud se hranice posunula.  
  - [ ] **5\. Striktní oddělení expanze a útoků ve válce:** Zamezení automatickému hitování soupeře při expanzi do wilderness i během trvajícího válečného stavu, pokud není cíleně zvolen útok na soupeřův sektor.  
  - [ ] **Zpětná vazba a chyby z testování verze m1.3 (Krok 2C):** Vyhlášení války a okamžitá anexe fungují dobře, ale návrat na ostrý pixelový render působí opět příliš kostičkovaně a hranatě (je požadován přirozenější, plynulejší vzhled bez rozmazání i bez hrubých kostiček); AI boti působí místy silně, ale takticky nevyváženě; hráč se dostal do situace, kdy nemohl útočit zpět na bota, který na něj zaútočil bez předchozího vyhlášení války hráčem; double-tap zanechává na mapě drobné nezačištěné zbytky („tečky“); pod tlakem více botů dochází k trvalému uvíznutí na extrémně nízkém Manpoweru („death spiral“).  
- [ ] **Krok 2D (Opravný a stabilizační sprint verzí m1.3 / m1.4): Oprava obousměrné války, vyhlazení renderu, dočištění teček a pojistka Manpoweru**  
  - [ ] **Dotčené moduly:** src/engine/frontExpansion.ts, src/engine/simulation.ts, src/engine/bots.ts, src/render/canvasRenderer.ts, src/ui/hud.ts.  
  - [ ] **1\. Obousměrný válečný stav (WAR):** Útok nebo vyhlášení války botem okamžitě aktivuje obousměrný vztah WAR, čímž se hráči zpřístupní okamžitý protiútok bez blokace.  
  - [ ] **Zpětná vazba a chyby z testování verze m1.4 (po Kroku 2D):** Vizuál mapy působí výrazně fluidněji a lépe, nicméně se odhalily následující nedostatky: (1) příliš pomalé celkové tempo partie (\~50 minut i bez zapojené ekonomiky a výzkumu), (2) nefunkční tlačítko „Vyhlásit válku“ v kontextovém menu pravého kliku (válka šla vyhlásit pouze přes 2s Ambush šipkou), (3) nekonzistentní a náhodná detekce anexe obklíčených kapes, (4) umělé „čtvercové“ vyplňování území při double-tapu místo plynulého organického obklíčení ze všech směrů a (5) bezpodmínečné přijímání aliancí ze strany AI botů.  
- [x] **Krok 2E (HOTOVO v m1.5): Oprava tlačítka války, organický zábor, deterministická anexe a zachování tempa**  
  - [x] **Dotčené moduly:** src/engine/frontExpansion.ts, src/engine/simulation.ts, src/ui/hud.ts, src/ui/leaderboard.ts.  
  - [x] **1\. Oprava akce „Vyhlásit válku“ v UI:** Oprava akce Vyhlásit válku (\`DECLARE\_WAR\`) v kontextovém menu pravého kliku i v leaderboardu tak, aby šla válka spolehlivě vyhlásit kliknutím v UI vedle 2s Ambush šipky.  
  - [x] **2\. Organický / fluidní tvar výplně území:** Odstranění čtvercového vyplňování při double-tapu a expanzi a nahrazení plynulým obklopením ze všech přilehlých směrů po vzoru OpenFront.  
  - [x] **3\. Deterministická anexe kapes podle přísné Varianty A:** Anektování POUZE kapes bez jednotek a budov, které jsou čistě uzavřené územím jednoho hráče a nikde nesousedí s vodou, jiným hráčem/státem ani hranou mapy (všech 6 simulačních testů úspěšně prošlo).  
  - [x] **4\. Zachování rozumného tempa bojů (Varianta A):** Ponechání čitelného a rozumného tempa bojů bez plošného zrychlování, které by po přidání jednotek a Tech Tree vedlo ke zmatku.  
  - [x] **5\. Vylepšení AI a aliancí až v Kroku 9 (Varianta B):** Komplexní vylepšení umělé inteligence botů a jejich opatrnějšího aliančního rozhodování se plně ponechává až na vyhrazený Krok 9\.  
- [ ] **Krok 3 (AKTUÁLNÍ PRIORITA): Ekonomika 6 pilířů, stavba budov na mapě, alokace Manpoweru a vyvážení zón**  
  - [ ] **2\. Přirozené a plynulé vykreslení mapy:** Vyladění renderování pro dosažení přirozeného, vyhlazeného kartografického vzhledu bez rozmazání i bez hrubých pixelových kostiček.  
  - [ ] **3\. Dočištění drobných zbytkových kapes („teček“):** Implementace automatické čistící logiky při double-tapu / plném náporu pro odstranění izolovaných mikrokapes soupeře.  
  - [ ] **4\. Regenerační pojistka Manpoweru:** Zapojení minimálního obranného/regeneračního prahu Manpoweru, který zabrání bezvýchodné smyčce vyčerpání pod tlakem více botů.  
  - [ ] **5\. Stabilizace průjezdu šipky přes cizí území:** Ošetření trasy šipky tažené z vlastního území přes cizí stát zpět na vlastní území tak, aby se nesundal zdroj a nedošlo k rozbití směru.  
  - [ ] **2\. Stavba fyzických budov a rozvoj zázemí:** Město, Důl, Elektrárna/Rafinérie, Zbrojovka, Laboratoř, Kasárna, Přístav, Letiště \+ 1\. free startovní elektrárna zdarma. Důraz na budování zázemí (města, doly, elektrárny) pro generování sil a Manpoweru místo penalizace samotných útočných šipek.  
  - [ ] **3\. Surovinové zóny a necentrované optimum:** Výkon mimo zónu v omezeném režimu (cca 20–50 %), uvnitř kruhu až 100 %. Nevystředěné body optima skryté před DevTools/F12 a finální odhalení přesné efektivity až po postavení budovy.  
  - [ ] **4\. Alokace a přetížení Manpoweru (0–200 %):** Rozložení Manpoweru mezi městy a zázemím. Posuvníky obsazenosti budov (200 % Manpoweru \= \+20 % buff / 120 % výkonu při 80 % účinnosti) s možností správy po typech budov, individuálně i centrálním přepínačem.  
- [ ] **Krok 4: Energetická rezerva, výpadky (blackout) a obranné stavby**  
  - [ ] **5\. Ladění speed-upu simulace (\`10x\` / \`50x\`):** Oprava stropu ticků na snímek v \`main.ts\` hned na začátku Kroku 3, aby volba \`10x\` skutočně odpovídala 10 herním sekundám za 1 reálnou sekundu.  
  - [ ] **Nové / upravené moduly:** src/engine/energyGrid.ts, src/engine/defenses.ts, src/render/effectsLayer.ts.  
  - [ ] **1\. Energetický systém a blackout:** Ukládání přebytků do rezervy, varování při deficitu a kaskádové odstavení při nule (pokles výroby, oslabení vojsk, úbytek Manpoweru ve městech; budovy se nerozpadají, obnova po nahodění energie probíhá plynule).  
  - [ ] **2\. Obranná infrastruktura:** Stavba zákopů, opevnění, protitankových zátarasů a systémů PVO zpomalujících a poškozujících útočné šipky i taktické jednotky.  
- [ ] **Krok 5: Specializované pozemní jednotky, napojení na šipku a obklíčení**  
  - [ ] **Nové / upravené moduly:** src/engine/units.ts, src/engine/combat.ts, src/render/unitRenderer.ts, src/ui/unitPanel.ts.  
  - [ ] **1\. Spektrum pozemních sil:** Pěší divize/průzkum, Tanky, Dělostřelectvo \+ paravýsadkáři do týlu na klíčové body.  
  - [ ] **2\. Napojení jednotek na šipku a údržba:** Přiřazení taktické figurky k útočné šipce pro průlom; po skončení šipky zůstávají na místě s možností pomalé opravy v poli či rychlé v zázemí.  
  - [ ] **3\. Obklíčení, energetická izolace a kořistění:** Jednotka na odříznutém území nemizí, nadále bojuje bez energie, nemůže projít bez vybojování cesty; po porážce zanechá loot, případně s odemčeným výzkumem možnost zajetí/převzetí.  
- [ ] **Krok 6: Námořnictvo, letectvo, překonávání vody a částečný Fog of War**  
  - [ ] **Nové / upravené moduly:** src/engine/navalAir.ts, src/engine/visibility.ts.  
  - [ ] **1\. Námořní tranzit a ostrovy:** Překonávání vodních ploch výhradně přes přístavy a výsadková plavidla (zranitelnost během tranzitu); sdílená energie ostrovů v rámci jednoho státu.  
  - [ ] **2\. Vzdušné a námořní síly:** Stíhačky, bombardéry, průzkumná letadla, křižníky, ponorky a letadlové lodě fungující v rámci operačního dosahu.  
  - [ ] **3\. Částečná mlha války (Fog of War):** Viditelnost hranic států zachována, ale detailní počty jednotek, budovy a PVO jsou odhalovány až blízkostí hranic/jednotek, průzkumem či radary.  
- [ ] **Krok 7: Technologický strom (5 větví), profily šipek a rare looty**  
  - [ ] **Nové / upravené moduly:** src/engine/techTree.ts, src/engine/lootZones.ts, src/ui/techTreeModal.ts.  
  - [ ] **1\. Strom 5 větví (Levely 1–5):** Pozemní armáda, Dělostřelectvo/Podpora, Letectvo, Námořnictvo, Ekonomika & Obrana s vysokou cenou vyžadující volbu doktríny.  
  - [ ] **2\. Profily šipek a pokročilé ložiska:** Odemčení těžkého průmyslu/ropy v mapě, nastavení úzkých průbojných vs. širokých plošných šipek a zpřesňování kruhů rare lootů na mapě.  
- [ ] **Krok 8: Burza (Trade), časované mise a Vědecké vítězství ("Div světa")**  
  - [ ] **Nové / upravené moduly:** src/engine/market.ts, src/engine/missions.ts, src/engine/victory.ts, src/ui/leaderboard.ts.  
  - [ ] **1\. Dynamická burza & Časované mise:** Trh reagující zdražováním na poptávku a časované mise vojsk mimo domov s prahem sil proti exploitům.  
  - [ ] **2\. Všechny 3 cesty k vítězství a barevné odlišení vztahů:** Totální eliminace, Teritoriální dominance (80 % pevniny) a Vědecký cíl (úrovně 1–10 s dynamicky se měnícími surovinovými nároky a dvoufázovým zobrazením v leaderboardu: raná vs. závěrečná fáze). V leaderboardu a přehledu států se zřetelně zobrazuje barevné odlišení vztahů (červeně válka, zeleně aliance).  
- [ ] **Krok 9: Vylepšení AI botů pro komplexní mechaniky**  
  - [ ] **Dotčené moduly:** src/engine/bots.ts.  
  - [ ] **Rozšířená autonomie AI:** Boti staví fyzické budovy, spravují energetickou rezervu, kombinují útočné šipky s taktickou technikou, plánují paravýsadky/přístavy a aktivně usilují o vybranou podmínku vítězství.  
- [ ] **Krok 10: Autoritativní multiplayer server (až 20 hráčů), lobby a rychlý mód**  
  - [ ] **Nové / upravené moduly:** server/index.ts, server/roomManager.ts, src/net/clientSocket.ts, src/ui/lobby.ts.  
  - [ ] **Plná serverová autorita & Síťová vrstva:** Přesun enginu z src/engine/ na Node.js/WebSocket server s plnou ochranou proti F12/DevTools cheatování (klient přijímá pouze odhalená data), lobby systém pro 4–20 hráčů a možnost volby zrychleného 15–20min herního režimu.

## **6\. Vítězné podmínky (Více cest k vítězství)**

Partie nabízí různé strategické cesty k dosažení vítězství:

* **Totální eliminace:** Úplné zničení nebo kapitulace všech soupeřů na mapě.  
* **Teritoriální dominance:** Kontrola stanoveného podílu mapy (např. 80 % pevniny).  
* **Vědecké / Technologické vítězství ("Div světa"):** Spočívá v progresivním vylepšování úrovní (1 až 10). Tento progres hráč neztrácí ani při zničení či ztrátě jednotlivých budov a při dobytí nebo kapitulaci nepřechází na dobyvatele. Vylepšení vyžaduje velké množství Knowledge a od vyšších úrovní i další suroviny. Požadované suroviny podléhají dynamickým změnám a periodické obměně (např. každých několik minut se upravují podle aktuálního nedostatku či poptávky na trhu a mapě), což brání opakování stejného scénáře. Aby se předešlo okamžité koordinované likvidaci hráče těsně před cílem při odhalení přesného levelu, leaderboard nezobrazuje přesné číslo úrovně (1–10), ale pouze hrubou dvoustupňovou fázi postupu: raná fáze (první polovina, úrovně 1–5) vs. pokročilá/závěrečná fáze (druhá polovina, úrovně 6–10). Dosažení 10\. úrovně znamená okamžité vítězství.

---

## **Otevřené otázky k řešení**

1. *Jak nastavit optimální rychlost gradientního vyčerpávání regionálních surovinových spotů při dlouhodobé těžbě?*  
2. *Jak vyvážit odměny z časovaných automatických misí tak, aby byly atraktivní, ale nezpůsobily přílišné riziko při oslabení domácí obranie?*  
3. *Jaký systém výherních podmínek zvolit (body za města vs. kapitulace všech soupeřů)?*

---

# **7\. Technická architektura, práce s AI (Antigravity) a bezpečnost**

## **Modulární a strukturovaný kód**

Projekt je navržen s důrazem na prevenci vzniku neudržitelného „spaghetti kódu“ a ztráty kontextu AI vývojáře. Kódová základna je striktně rozdělena do oddělených modulů:

* **Herní smyčka a stav (Game Loop & State):** Řízení časování, synchronizace a centrálního stavu partie.  
* **Mapa a terén:** Vektorové fronty, pixelová mapa, terénní typy a průchodnost.  
* **Ekonomika a budovy:** Surovinové toky, alokace Manpoweru a produkce.  
* **Jednotky a boje:** Taktický pohyb, bojové vzorce, stav obklíčení a údržba.  
* **AI boti:** Autonomní rozhodování a simulace protivníků.  
* **Uživatelské rozhraní (UI):** Zobrazovací vrstva a vstupy od hráče.

Vývoj probíhá v malých, samostatně ověřitelných krocích s přehlednou dokumentací rozhraní mezi moduly.

## **Nástroje a pracovní postup pro efektivitu a nízké náklady na tokeny**

Při práci v prostředí Antigravity je klíčová optimalizace kontextového okna AI. Využívají se specializované doplňky a pluginy pro mapování struktury a závislostí kódu (Graphify, PonyTail, Caveman). Nástroje/doplňky Graphify, Caveman a PonyTail jsou již nainstalovány v prostředí uživatele a využívají se k udržení přehledné modulární struktury a efektivní spotřeby kontextu/tokenů při navazujících krocích v Antigravity. Uživatel vnímá zapojení kombinace těchto nástrojů jako smysluplné už v ranějších fázích pro lepší organizaci kódu a prevenci ztráty přehledu do budoucna. Zároveň je však potřeba držet jejich zapojení rozumné a nekomplikovat tím zbytečně prostředí, dokud se kódová základna rozrůstá. Doporučuje se efektivní kombinování orchestrátoru a vhodných/rychlejších AI modelů pro běžnou kódovou strukturu a UI rozhraní, zatímco silnější modely se šetří na náročné bugy a komplexní logiku simulace, se stálým zaměřením na přehledné UI a bezpečnou architekturu bez AI slopu. Asistent připravuje přesné prompty a architekturu pro Antigravity s důrazem na průběžné verzování a testování dílčích modulů.

* **Automatizované / simulované testování z pohledu hráče:** Vývojový proces je doplněn o automatizované testovací scénáře a simulátory (headlessly běžící skripty prověřující chování útočných šipek, obklíčení, anexi kapes, obousměrnost válečného stavu a regeneraci Manpoweru), které umožňují zachytit logické a simulační chyby dříve, než na ně uživatel narazí ručně během hraní.

## **Autorita serveru a ochrana proti podvádění (Anti-cheat)**

## **Autorita serveru a ochrana proti podvádění (Anti-cheat & DevTools F12)**

Veškerá herní logika, výpočty (stav surovin, bojové střety, validace útoků, plnění podmínek) i citlivé informace o mapě podléhají primární autoritě serveru. Skryté souřadnice optimálních těžebních bodů, neprozkoumaných zón, rare lootů a přesná procentuální efektivita nejsou předčasně zasílány do klientského prohlížeče, čímž je znemožněno jejich odhalení čtením paměti či sledováním klientských dat v DevTools (F12). Klientská aplikace slouží výhradně k vykreslování odhalených dat a odesílání vstupů hráče.

## **Kvalita vizuálu a UI (Anti-AI-slop)**

Důraz je kladen na kompletní předělání vizuálního zpracování z Kroku 1 a odstranění "tragického" vzhledu. Vzhled mapy i uživatelské rozhraní musí odpovídat profesionální kartografii a přehlednému UI bez nevkusného AI slopu. UI obsahuje jasnou barevnou hierarchii front, přehledné ekonomické ukazatele a čisté vektorové renderování.

## **Road Plan spolupráce s Antigravity, pravidla generování promptů a správa paměti**

Pro maximální efektivitu vývoje, prevenci chybných zásahů a eliminaci regresí se uplatňují následující zásady řízení projektu a generování kódových zadání:

* **GDD jako centrální paměť (Single Source of Truth):** Tento Game Design Document slouží jako hlavní paměťový uzel. Před zadáním nového modulu v Antigravity se specifikace nejprve zakotví zde.  
* **Role asistenta při návrhu architektury a promptů:** Asistent připravuje přesná kódová zadání, definuje modulární rozhraní (API), určuje akceptační kritéria a strukturuje prompty pro AI tak, aby se minimalizoval přenos zbytečného kontextu a šetřily tokeny.  
* **Autorita serveru a modulární struktura:** Kód je striktně rozdělen do samostatných, testovatelných modulů. Veškerá klíčová logika (ekonomika, boje, validace) probíhá na serveru pro zajištění bezpečnosti (anti-cheat).  
* **Inkrementální vývoj, testování a verzování:** Vývoj probíhá v malých sprintech s průběžným verzováním (Git) a automatizovaným testováním dílčích modulů před odsouhlasením kontrolních bodů.  
* **Souhrn klíčových požadavků a architektonických pilířů:** Vývoj je připraven k okamžitému zahájení Kroku 1 v Antigravity na čisté modulární architektuře v TypeScriptu s vykreslovací vrstvou v HTML5 Canvas. Veškerá herní logika a výpočty stavu jsou přísně připraveny na serverovou autoritu, aby se zamezilo podvádění a manipulaci hodnot přes prohlížeč (DevTools / F12). Vizuální styl UI sleduje zásady přehlednosti bez zbytečného AI slopu. Veškerá specifikace se průběžně ukotvuje v tomto GDD a vývoj v Antigravity je řízen přes přesná, izolovaná kódová zadání šetřící kontextový rozsah tokenů.