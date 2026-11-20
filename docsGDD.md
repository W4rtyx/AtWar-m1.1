GAME DESIGN DOCUMENT
Projekční koncept hybridní real-time strategie
________________


1. Základní vize a parametry hry
Tento projekt kombinuje dynamický průběh hraní s hlubokým takticko-strategickým rozhodováním. Klade si za cíl propojit plynulé zabírání území známé z OpenFront s rozsáhlými možnostmi výzkumu, stavby a mikro-manažmentu specializovaných jednotek z Call of War. První testovací mapa je zasadena do prostředí Evropy (obsahuje hory, nížiny, poloostrovy i ostrovy pro důkladné ověření terénní průchodnosti, námořního zásobení i leteckých operací).


* Herní koncept: Strategická real-time hra propojující rychlou frontovou expanzi a zjednodušenou mikro-kontrolu specifických bojových složek.
* Cílová délka partie:
   * Standardní režim: 35–45 minut (vyvážený poměr mezi expanzí a výzkumem).
   * Rychlý režim (plánováno): 15–20 minut (zjednodušený výzkum, zrychlené posuny fronty).
* Počet účastníků:
   * Maximální kapacita mapy: 20 hráčů.
   * Optimalizovaný stav pro standardní zápas: 4–12 hráčů (doplněno o AI boty do plného stavu).
* Herní režimy:
   * Singleplayer: Tréninkové zápasy a scenáristické bitvy proti přizpůsobitelným AI botům.
   * Multiplayer: Lobby systém, veřejné a soukromé partie, kooperativní zápasy proti AI.


________________


2. Herní tempo a ovládání (Hybridní model)
Tempo hry
Hra využívá zpomalený real-time systém. Na rozdíl od extrémně rychlých klikacích strategií je celková rychlost posunu fronty a výroby upravena tak, aby hráči měli dostatek času na:


1. Vyhodnocení strategické situace na více bojištích současně.
2. Správu ekonomiky a plánování technologického stromu.
3. Koordinaci kombinovaných útoků (pozemní, letectvo, námořnictvo).
Kombinovaný systém řízení bojů
Složka ovládání
	Mechanika a funkce
	Typické použití
	Frontová expanze
	Kreslení směrů útoků (vektorové šipky) po hranicích. Automatický tlak pěchotních linií.
	Hlavní zabírání území, udržování souvislé linie defensive/offensive.
	Specializované jednotky
	Ruční ovládané taktické figurky pohybující se volně po mapě.
	Průlom fronty, průzkum, přesné obchvaty, taktika hit-and-run.
	

* Frontový útok (Šipka) a mobilizace: Místo nejasného globálního procenta z celé říše má hráč mobilizovanou sílu v lokálních shromaždištích a zónách poděl hranic či měst. Útočné šipky čerpají síly z těchto zón. Je k dispozici také výsadek parašutistů hlouběji do týlu, kteří dokáží obsadit klíčové body a otevřít nové směry tlaku, zatímco síly vyslané na mise nejsou dočasně dostupné jinde.
* Napojení specializovaných jednotek na šipku a chování na konci útoku: Tanky, dělostřelectvo a podpora se dají kliknutím přiřadit ke konkrétní útočné šipce. Po skončení útočné šipky zůstávají jednotky primárně na místě (s možností ručního přesunu, opravy na místě pomalejším tempem nebo návratu k opravárenskému bodu).
* Samostatné cílení a částečná mlha války (Fog of War): Letectvo a námořnictvo mohou fungovat v dosahu na konkrétní cíle. Přesné počty a pohyby nepřátelských jednotek a detailní obrany nejsou vidět po celé mapě; odhalují se blízkostí hranic/jednotek, průzkumem, radary či loděmi/letadly s příslušným dosahem a vylepšeními (např. odhalení pobřežní PVO lodí s radarem pro následný nálet).
* Obranné prvky, ústup/obklíčení, energetická izolace a zajmutí/kořistění: Opevnění, zákopy, protitankové zábrany a PVO brzdí šipky. Když nepřítel zabere území pod jednotkou, jednotka nezmizí automaticky bez boje, ale nadále se brání a způsobuje útočníkovi ztráty podle síly a typu střetu. Jednotka nemůže utéct skrz nepřátelské území bez vybojování cesty ven – zůstává uvězněna v ohnisku, dokud se neprobojuje nebo ji nevysvobodí posily zvenčí. Oddělené či obklíčené jednotky v nepřátelském území nemají přísun energie/zásobování, postupně slábnou a rozpadají se. Ostrovy vlastněné státem sdílejí energii v rámci jednoho státu pro zachování přehlednosti a hratelnosti. Při porážce obklíčené taktické jednotky hráč automaticky získá určitý loot/zdroje; pokud má odemčený příslušný upgrade v tech tree, může jednotku i zajmout a převzít pro sebe.
* Start partie (Výběr startovní pozice po vzoru OpenFront): Hráči si kliknutím na mapu vyberou startovní pozici. Vidí hranice a velikost území ostatních států, ale nevidí jejich detailní vnitřní vývoj, postavené budovy, úrovně upgradů, složení jednotek ani stav Manpoweru (dokud to neodhalí průzkum/špionáž/výzkum). Po startu se automaticky založí hlavní město s počátečním územím, základním příjmem peněz, Manpowerem, základem stavebního materiálu a možností postavit první elektrárnu zdarma (free startovní budova pro rozjezd energetické rezervy).
* Expanze na volné území (Wilderness), vliv terénu a strategie útočných šipek: Kreslení útočných šipek zabírá okolní neobsazené území (wilderness) i nepřátelské hranice. Rychlost postupu útočné šipky je přímo ovlivněna množstvím nasazeného Manpoweru – vyšší nasazený Manpower zrychluje postup do wilderness i přes hranice. Terén (např. hory vs. nížiny) výrazně zpomaluje postup fronty a omezuje průchodnost těžké techniky. Hráči mají navíc možnost odemykat v tech tree a doktrínách různé profily/strategie útočných šipek (např. užší, průbojnější šipku pro rychlý hluboký průnik vs. širší, pomalejší postup pro plošné zajištění území), aniž by se tím zkomplikovalo intuitive zakládání základního útoku. Hráč může kromě běžných útočných šipek označit/zakroužkovat konkrétní část své fronty či vytvořený výběžek/půlměsíc a určit směr tlaku (např. tlačit vybranou frontu doleva/doprava/do středu/ven), aby šlo takticky uzavírat kapsy, rozšiřovat konkrétní křídlo a lépe řídit strategii postupu než jen prostým plošně-jednotným náporem.
* Rozložení Manpoweru, mobilizace a obsazenost budov: Místo složitých zón, kroužků nebo „fluidu“ vojáků po hranicích se Manpower spravuje přes posuvníky či procentuální alokaci – pro každý typ budovy (např. továrny, laboratoře, letiště, přístavy, kasárna) zvlášť, případně individuálně u konkrétní budovy, s možností centrálního ovládání pro rychlé přepnutí (např. 100 % do optima). Zbývající aktivní Manpower je k dispozici pro útoky (útočné šipky) a obranu napříč celým státem. Když hráč pošle např. 50 % aktivního Manpoweru do útoku na jedné straně, zbytek aktivního Manpoweru je slabší i na jiných směrech (přičemž lidé vázaní v provozu budov se do útočné šipky nepočítají). Ostatní hráči nevidí přesný rozpad alokace Manpoweru soupeře, pokud to nezjistí např. přes výzkum či špionáž.


________________


3. Ekonomika a suroviny
Ekonomika stojí na šestici surovinových pilířů, přičemž veškerá lidská pracovní i vojenská síla je sjednocena pod zdroj Manpower. Pro zachování přehlednosti a hratelnosti platí limit nákladů na položku: žádná budova ani jednotka nevyžaduje pět různých surovin najednou – cílem jsou maximálně 2–3 různé nákladové složky (u nejtěžších jednotek max. 3). Budovy se nacházejí na plynulé pixelové mapě v regionálních spotech.
Pilíře ekonomiky
1. Peníze (Finance)
   * Zdroj: Zdanění obsazených území, města a finanční centra.
   * Využití: Uplatňují se napříč celou ekonomikou – zejména pro nákup a verbování jednotek, obchod na burze, kombinaci nákladů u stavby budov a náročné pokročilé výzkumy v tech tree (aby nebylo možné snadno odemknout všechny větve naráz bez silné ekonomiky a jasné strategie/doktríny). Zachovává se limit maximálně 2–3 různých surovinových složek u nejtěžších položek.
2. Znalosti (Knowledge / Výzkum)
   * Zdroj: Laboratoře, knihovny a výzkumná střediska v krajských městech. Získané znalosti se při zničení budov neztrácejí.
   * Využití: Slouží výhradně k odemykání uzlů v technologickém stromu (tech tree) a financování progresu vědeckého cíle; neutrácí se jako spotřební komodita na běžné stavby.
3. Stavební materiál
   * Zdroj: Doly, kamenolomy a lehké továrny.
   * Využití: Základní stavby (města, vesnice, infrastruktura, opevnění) v kombinaci s penězi a základním materiálem.
4. Průmysl
   * Zdroj: Zbrojovky a továrny lehkého i těžkého průmyslu.
   * Využití: Těžší budovy a výroba či modernizace lodí, tanků, letadel a zbraní.
5. Ropa / Energie
   * Zdroj: Ropná pole, rafinérie a elektrárny.
   * Využití: Slouží k udržení provozu budov a jednotek. Energie/ropa má plynulý přísun z elektráren/zdrojů a ukládá se do energetické zásoby (rezervy), pokud produkce převyšuje spotřebu. Při výpadku elektráren nebo poklesu produkce pod spotřebu se nejprve čerpá z této rezervy. Jakmile zásoba klesne na nulu, nastává kritický energetický deficit / výpadek (blackout) s výrazným varováním v UI. Systém spustí postupný pokles výkonu továren a budov (až po úplné odstavení při trvající nule), oslabování bojových jednotek a postupný úbytek Manpoweru ve městech, což dává hráčům čas krizi řešit. Budovy ani města se při výpadku energie fyzicky nerozpadají ani nemizí (lze je po obnovení energie znovu zprovoznit nebo je může obsadit a zprovoznit nepřítel). Po obnovení dodávek energie se obnova budov, výkonu i Manpoweru rozbíhá postupně, nikoli okamžitě.
6. Vojáci (Manpower)
   * Zdroj: Obnovující se lidský potenciál na území a v sídlech.
   * Využití: Neplatí se jím jako běžnou spotřební komoditou – představuje lidi/vojáky připravené k operativnímu nasazení v boji (útočné šipky, obrana) a k obsluze a provozu budov či továren.
Tržiště / Burza (Trade)
Hráči mají k dispozici automatickou burzu a obchod se základními kurzy, které dynamicky reagují na poptávku (zdražování při vysoké poptávce brání nekonečnému zneužívání směn). Dále jsou k dispozici automatické časované mise (výprava části vojáků mimo domov na předem daný čas s rostoucí odměnou/lootem při větším nasazení, vyžadující minimální práh sil proti early-game exploitům, za cenu dočasného oslabení domácí obrany).
Fyzické budovy na mapě a typ mapy
Na plynulé/pixelové mapě budovy zabírají reálný prostor bez pevných předkreslených slotů. Hráč volí přesné umístění (např. pobřeží vs. vnitrozemí s ohledem na riziko ostřelování z moře či vzduchu a celkový prostor). Budovy lze dále vylepšovat skrz Tech Tree.
7. Surovinové zóny (kruhy s nevystředěným optimem) a skrývání pokročilých zdrojů: Základní zdroje (stavební materiál, základní energie) jsou vidět od začátku v podobě kruhových oblastí. Skutečné optimum těžby/efektivity (100 % základního zisku) se nenachází přesně v geometrickém středu kruhu, ale je posunuto někde uvnitř zóny – čím dál od optima hráč budovu postaví, tím nižší má efektivitu. Pokročilé suroviny (těžký průmysl, vyspělá energetická ložiska) nejsou na začátku na mapě vůbec vidět a odhalují se až po odemčení příslušné technologie v tech tree (případně průzkumem/skautingem).
8. Přetížení těžebních a energetických budov v zónách: Hráč může posuvníkem zvýšit obsazenost budovy až na 200 % Manpoweru, čímž získá bonus k výkonu (např. 120 % výkonu dané lokality), ale při snížení celkové efektivity přepočtu energie/surovin (např. jen 80 % reálné energetické výtěžnosti oproti optimálním 100 % obsazenosti). Pokročilé elektrárny/zdroje z vyšších úrovní tech tree mají vyšší základní efektivitu a menší závislost na poloze ložiska.
9. Rare looty / speciální nálezy na mapě a dynamické zóny: Při obsazování území/wilderness se vyskytují zóny s procentuální šancí na speciální nálezy (rare looty – bonusové suroviny, peníze, zrychlení výzkumu). Na začátku partie nejsou přesně vidět nebo mají pouze velkou přibližnou oblast, která se s pokrokem v tech tree, vylepšením konkrétních budov nebo průzkumem postupně zmenšuje a zpřesňuje. Rozmístění těchto nálezů se v každé partii mění, aby se předešlo šablonovitému hraní. Reálná procentuální efektivita daného místa se hráči finálně odhalí až po postavení příslušné budovy, přičemž tyto citlivé údaje podléhají autoritě serveru a nejsou předčasně odhalitelné přes F12 / DevTools v prohlížeči.
10. Města: Zdroj příjmů z daní a základní alokace Manpoweru.
11. Továrny & Rafinérie: Průmyslová výroba materiálů, zbraní a ropy.
12. Laboratoře / Knihovny: Generování Knowledge.
13. Kasárna: Verbování a výcvik jednotek.
14. Letiště a Přístavy: Nevyhnutelné pro stavbu a operace letectva a loďstva.
Ztráta budovy reálně omezí produkci nebo provozování příslušného typu jednotek (vyjma již vyzkoumaných technologií).
________________


4. Technologický strom (Tech Tree)
Technologický strom je rozdělen do 5 specializovaných větví. Každý národ či hráč se může zaměřit na jinou doktrínu (např. blesková pozemní válka vs. námořní dominance).
Větve výzkumu
* Pozemní armáda: Vylepšení pěchoty, lehkých a těžkých tanků, protitankového vybavení.
* Dělostřelectvo a podpora: Zvýšení dostřelu, přesnosti, mobilní protivzdušná obrana, inženýrské jednotky.
* Letectvo: Stíhačky pro nadvládu ve vzduchu, taktické a strategické bombardéry, průzkumná letadla.
* Námořnictvo: Křižníky, ponorky, letadlové lodě a výsadková plavidla.
* Ekonomika a infrastruktura: Zvýšení efektivity těžby surovin a dopravy.
* Obranné technologie: Výzkum a stavba zákopů, minových polí, protitankových zátarasů a systémů protivzdušné obrany (PVO).
Systém úrovní (Levelování)
Každá jednotka má několik úrovní (Level 1–5). Zvýšení úrovně přináší různé benefity:


* Level 1 (Základ): Dostupné standardní jednotky od začátku hry.
* Level 2–3 (Modernizace): Zvýšení poškození, odolnosti a rychlosti pohybu.
* Level 4–5 (Elitní úroveň): Speciální schopnosti (např. kamufláž, prodloužený dostřel, pasivní aura pro okolní frontu).


________________


5. Stav projektu a plán vývoje
Vývoj je rozdělen do tří hlavních fází s cílem doručit včas hratelný prototyp a postupně rozšiřovat funkcionalitu.
Fáze 1: Návrh detailních mechanik
* Definice základního konceptu a ekonomických pilířů.
* Matematický model bojového systému (vzorce pro střety na frontě a poškození jednotek).
* Návrh algoritmu startu na mapě (rozostavení počátečních měst a surovin).
* Kompletní specifikace ekonomických závislostí a nákladů na výzkum.
* Krok 1 (Příprava a zahájení prvního kódového sprintu v Antigravity): Projekt je plně připraven k zahájení Kroku 1. Vytvoření čisté, modulární kostry projektu (TypeScript + HTML5 Canvas), mapa Evropy s vizualizací terénu (hory, nížiny) a základními surovinovými zónami, výběr startovního města a funkční prototyp plynulého posunu fronty / výběru směru tlaku do wilderness.
Fáze 2: Prototyp v Antigravity
* Implementace funkčního vektoru posunu fronty.
* Testovací mapa Evropa (hory, nížiny, poloostrovy, ostrovy) a vyladění surovinové trojice (Stavební materiál, Průmysl, Ropa).
* Singleplayer mód s testovací AI (jednoduchá expanze AI na volná území).
* Testovací rozhraní pro ovládání 2-3 typů jednotek (pěchota, tank, dělostřelectvo).
Fáze 3: Rozšíření a Multiplayer
* Dokončení celého technologického stromu (všechny 5 větve).
* Vyvážení rychlosti hry, nákladů a efektivity jednotek (Balancing).
* Síťová architektura a implementace Multiplayeru pro až 20 hráčů.
* Grafické a zvukové poladění rozhraní (UI/UX).
Road Plan a pravidla vývoje v Antigravity
* Fáze A – Základní infrastruktura a mapa: Vytvoření reprezentace mapy Evropy (terénní typy, vodní plochy, města), implementace mechaniky plynulého posunu fronty a alokace Manpoweru/ekonomických zdrojů.
* Fáze B – Jednotky, boje a energetický systém: Implementace mikro-manažmentu taktických jednotek, mechaniky obklíčení/zásobování, energetických rezerv, blackoutů a logiky ostrovní izolace.
* Fáze C – Tech Tree, Vědecké vítězství a Multiplayer: Zapojení 5 větví výzkumu, dynamických surovinových požadavků vědeckého cíle (levely 1–10) s fázovou indikací v leaderboardu a síťové architektury pro až 20 hráčů.


6. Vítězné podmínky (Více cest k vítězství)
Partie nabízí různé strategické cesty k dosažení vítězství:
* Totální eliminace: Úplné zničení nebo kapitulace všech soupeřů na mapě.
* Teritoriální dominance: Kontrola stanoveného podílu mapy (např. 80 % pevniny).
* Vědecké / Technologické vítězství ("Div světa"): Spočívá v progresivním vylepšování úrovní (1 až 10). Tento progres hráč neztrácí ani při zničení či ztrátě jednotlivých budov a při dobytí nebo kapitulaci nepřechází na dobyvatele. Vylepšení vyžaduje velké množství Knowledge a od vyšších úrovní i další suroviny. Požadované suroviny podléhají dynamickým změnám a periodické obměně (např. každých několik minut se upravují podle aktuálního nedostatku či poptávky na trhu a mapě), což brání opakování stejného scénáře. Aby se předešlo okamžité koordinované likvidaci hráče těsně před cílem při odhalení přesného levelu, leaderboard nezobrazuje přesné číslo úrovně (1–10), ale pouze hrubou dvoustupňovou fázi postupu: raná fáze (první polovina, úrovně 1–5) vs. pokročilá/závěrečná fáze (druhá polovina, úrovně 6–10). Dosažení 10. úrovně znamená okamžité vítězství.
________________


Otevřené otázky k řešení
1. Jak nastavit optimální rychlost gradientního vyčerpávání regionálních surovinových spotů při dlouhodobé těžbě?
2. Jak vyvážit odměny z časovaných automatických misí tak, aby byly atraktivní, ale nezpůsobily přílišné riziko při oslabení domácí obranie?
3. Jaký systém výherních podmínek zvolit (body za města vs. kapitulace všech soupeřů)?


________________


7. Technická architektura, práce s AI (Antigravity) a bezpečnost
Modulární a strukturovaný kód
Projekt je navržen s důrazem na prevenci vzniku neudržitelného „spaghetti kódu“ a ztráty kontextu AI vývojáře. Kódová základna je striktně rozdělena do oddělených modulů:


* Herní smyčka a stav (Game Loop & State): Řízení časování, synchronizace a centrálního stavu partie.
* Mapa a terén: Vektorové fronty, pixelová mapa, terénní typy a průchodnost.
* Ekonomika a budovy: Surovinové toky, alokace Manpoweru a produkce.
* Jednotky a boje: Taktický pohyb, bojové vzorce, stav obklíčení a údržba.
* AI boti: Autonomní rozhodování a simulace protivníků.
* Uživatelské rozhraní (UI): Zobrazovací vrstva a vstupy od hráče.
Vývoj probíhá v malých, samostatně ověřitelných krocích s přehlednou dokumentací rozhraní mezi moduly.
Nástroje a pracovní postup pro efektivitu a nízké náklady na tokeny
Při práci v prostředí Antigravity je klíčová optimalizace kontextového okna AI. Využívají se specializované doplňky a pluginy pro mapování struktury a závislostí kódu (např. Graphify, PonyTail). Tyto nástroje umožňují předávat AI pouze relevantní části kódové základny bez nutnosti načítat celý projekt, což výrazně snižuje spotřebu tokenů, zrychluje odezvu a předchází regresi kódu. Asistent hraje klíčovou roli při přípravě přesných promptů, návrhu architektury a vytváření konkrétních kódových zadání pro Antigravity, čímž zajišťuje vysokou přesnost, organizaci kódu a vizuální kvalitu výstupu. Dodržuje se systém průběžného verzování a automatizovaného testování dílčích modulů.
Autorita serveru a ochrana proti podvádění (Anti-cheat)
Autorita serveru a ochrana proti podvádění (Anti-cheat & DevTools F12)
Veškerá herní logika, výpočty (stav surovin, bojové střety, validace útoků, plnění podmínek) i citlivé informace o mapě podléhají primární autoritě serveru. Skryté souřadnice optimálních těžebních bodů, neprozkoumaných zón, rare lootů a přesná procentuální efektivita nejsou předčasně zasílány do klientského prohlížeče, čímž je znemožněno jejich odhalení čtením paměti či sledováním klientských dat v DevTools (F12). Klientská aplikace slouží výhradně k vykreslování odhalených dat a odesílání vstupů hráče.
Kvalita vizuálu a UI (Anti-AI-slop)
Klademe důraz na čistý, vysoce čitelný a vizuálně soudržný styl uživatelského rozhraní i herní mapy. Vyhýbáme se generickému či přeplácanému vzhledu (anti-AI-slop). Veškeré UI prvky jsou navrženy s ohledem na přehlednost v real-time strategii, s jasnou barevnou hierarchií front, jednotek a ekonomických ukazatelů.
Road Plan spolupráce s Antigravity, pravidla generování promptů a správa paměti
Pro maximální efektivitu vývoje, prevenci chybných zásahů a eliminaci regresí se uplatňují následující zásady řízení projektu a generování kódových zadání:
* GDD jako centrální paměť (Single Source of Truth): Tento Game Design Document slouží jako hlavní paměťový uzel. Před zadáním nového modulu v Antigravity se specifikace nejprve zakotví zde.
* Role asistenta při návrhu architektury a promptů: Asistent připravuje přesná kódová zadání, definuje modulární rozhraní (API), určuje akceptační kritéria a strukturuje prompty pro AI tak, aby se minimalizoval přenos zbytečného kontextu a šetřily tokeny.
* Autorita serveru a modulární struktura: Kód je striktně rozdělen do samostatných, testovatelných modulů. Veškerá klíčová logika (ekonomika, boje, validace) probíhá na serveru pro zajištění bezpečnosti (anti-cheat).
* Inkrementální vývoj, testování a verzování: Vývoj probíhá v malých sprintech s průběžným verzováním (Git) a automatizovaným testováním dílčích modulů před odsouhlasením kontrolních bodů.
* Souhrn klíčových požadavků a architektonických pilířů: Vývoj je připraven k okamžitému zahájení Kroku 1 v Antigravity na čisté modulární architektuře v TypeScriptu s vykreslovací vrstvou v HTML5 Canvas. Veškerá herní logika a výpočty stavu jsou přísně připraveny na serverovou autoritu, aby se zamezilo podvádění a manipulaci hodnot přes prohlížeč (DevTools / F12). Vizuální styl UI sleduje zásady přehlednosti bez zbytečného AI slopu. Veškerá specifikace se průběžně ukotvuje v tomto GDD a vývoj v Antigravity je řízen přes přesná, izolovaná kódová zadání šetřící kontextový rozsah tokenů.