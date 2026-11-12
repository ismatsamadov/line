#!/usr/bin/env python3
"""
Write src/lib/busroute/places.json: the named places the bus planner's search offers as a
start or a destination (#720), such as malls, restaurants, universities, hospitals, markets,
hotels, parks, offices, metro stations and settlements.

The places are OpenStreetMap's (© OpenStreetMap contributors, under the Open Database
Licence 1.0). Google's place data was ruled out: its terms forbid storing it and showing
it on a map that is not Google's, and the planner draws OpenStreetMap tiles with Leaflet.
One Overpass API query (QUERY below) asks for every named feature in the bus network's
area that carries one of the tags a destination does, as OpenStreetMap had it at SNAPSHOT;
this script decides which of them the planner offers. Overpass serves past states, so the
query gives the same features whenever it is sent, and a lost answer can be fetched again.
Two steps, so the answer is kept as it came and the build can be re-run on it:

    python3 scripts/bus/build_places_json.py --fetch places-overpass.json
    python3 scripts/bus/build_places_json.py places-overpass.json

A refresh moves SNAPSHOT to a recent minute first.

Standard library only. What it decides, so that the planner does not have to:

- A place is a named feature of one of the categories in LABELS, worked out from its tags
  by category(), where the first test that matches wins: a hospital that is also a
  building is a hospital. Features of no category (parking, fuel, pharmacies, car repair,
  corner shops, industry, named buildings with no other tag) are left out, and so are a
  bus depot mapped as a bus station and an airfield no passenger flies from.
- Its name is name:az where there is one, else name; the other names it is searched by
  are name, name:ru, name:en, alt_name, old_name, short_name, official_name, brand and
  their :az and :ru forms. The mappers' "Name \\ Place" convention is written
  "Name / Place", and Cyrillic schwas inside Latin words become Latin ones.
- A name that only says what the place is ("Kafe", "Market", "Məscid", "Uşaq bağçası")
  is left out, and so is a building's number ("Bina 1", "Корпус № 2") and a name with no
  letters ("1941-1945"): none can be told apart from the next one in a list. Stations and
  settlements keep theirs. Someone's home or flat is left out too (private_home()): a
  guest house named a dacha or a person's home, a lodging named a flat to let, a flat's
  number, and a residence's fenced grounds mapped as a park. The build names each one.
- The metro is the planner's own: the 27 stations of metro.json, with its names and
  coordinates, and the other names of the OpenStreetMap station each one matches. A
  station OpenStreetMap has and metro.json has not (a depot, a station being built) is
  left out.
- A way or a relation is placed at its centre as Overpass gives it, the middle of its
  bounding box. Coordinates keep five decimals (about 1 m). The centre of an outline over
  LARGE_KM across can be nowhere one can go, so the build names each one for a person to
  check; the bounding boxes come in the query's last output. PLACED_AT puts such a feature
  at a feature inside it instead: the airport at its passenger terminal.
- Two features of one category with the same name (as the search folds it) within
  DUPLICATE_KM of each other are one place: the POI node of a mall and its building, the
  node of a town and its boundary. A node is kept before an outline, whose centre can
  be kilometres from where the mappers put the town's, then the one with the most names;
  it takes the others' names.
- A way or a relation centred outside the network's area (BBOX), which Overpass returns
  because it reaches into the area, is left out and named.
- What a person decided after reading the data is in CORRECTIONS, each with its reason: a
  tag's value replaced or left out, or a whole feature left out. A correction holds the
  value as mapped, and the build stops once OpenStreetMap no longer has it: a vandalism
  fix must not stop applying unseen. A person reads the feature and updates the entry.
- Every name and other name with a word from REVIEW (insults, profanity, crime, politics)
  is printed at each build for a person to read; vandalism goes into CORRECTIONS.
- ALIASES adds other names people search a well-known place by that OpenStreetMap does
  not have, each with where the name is used. The build stops if one's feature is gone.

ODbL 4.6: places.json is a derived database. This script, its query and the snapshot's
date (recorded in the file) are how it is produced; docs/bus-routing.md says so.
"""

import email.utils
import hashlib
import json
import math
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "src" / "lib" / "busroute" / "places.json"
METRO = ROOT / "src" / "lib" / "busroute" / "metro.json"
API = "https://overpass-api.de/api/interpreter"
USER_AGENT = "birjob-bus-planner/1.0 (+https://www.birjob.com/aletler/avtobus-marsrutu; scripts/bus/build_places_json.py)"
# The bus network's area: the extent of AYNA's stops (39.947-40.638 N, 49.402-50.356 E)
# and about 2 km around it, inside the envelope isBakuCoordinate (geo.ts) accepts. South,
# west, north, east, the order Overpass takes.
BBOX = (39.92, 49.37, 40.66, 50.39)
# The moment of OpenStreetMap the places are: the query asks for the data as it was then
# ([date:]), and places.json records it.
SNAPSHOT = "2026-11-11T06:09:21Z"
TIMEOUT_S = 900
QUERY = f"""[out:json][timeout:{TIMEOUT_S}][bbox:{BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}][date:"{SNAPSHOT}"];
(
  nwr[name][amenity];
  nwr[name][shop];
  nwr[name][office];
  nwr[name][tourism];
  nwr[name][leisure];
  nwr[name][healthcare];
  nwr[name][historic];
  nwr[name][building];
  nwr[name][railway~"^(station|halt)$"];
  nwr[name][public_transport=station];
  nwr[name][aeroway~"^(aerodrome|terminal)$"];
  nwr[name][place];
  nwr[name][natural=beach];
  nwr[name][landuse~"^(retail|commercial|residential)$"];
  nwr[name][man_made~"^(tower|lighthouse|pier)$"];
)->.found;
node.found;
out qt;
(way.found; relation.found;);
out tags center qt;
out ids bb qt;
"""
EARTH_RADIUS_KM = 6371.0

# category: the label the planner shows beside a place, in Azerbaijani. The order is the
# order the file lists them in; category() decides which one a feature gets.
LABELS = {
    "metro": "Metro stansiyası",
    "rail": "Dəmiryol stansiyası",
    "bus_station": "Avtovağzal",
    "airport": "Hava limanı",
    "port": "Dəniz vağzalı",
    "mall": "Ticarət mərkəzi",
    "market": "Bazar",
    "supermarket": "Supermarket",
    "shop": "Mağaza",
    "restaurant": "Restoran",
    "cafe": "Kafe",
    "hotel": "Otel",
    "university": "Universitet",
    "college": "Kollec",
    "school": "Məktəb",
    "kindergarten": "Uşaq bağçası",
    "hospital": "Xəstəxana",
    "clinic": "Klinika",
    "government": "Dövlət qurumu",
    "embassy": "Səfirlik",
    "post_office": "Poçt",
    "bank": "Bank",
    "office": "Ofis",
    "park": "Park",
    "square": "Meydan",
    "sight": "Görməli yer",
    "museum": "Muzey",
    "theatre": "Teatr və kino",
    "culture": "Mədəniyyət mərkəzi",
    "sport": "İdman",
    "fun": "Əyləncə",
    "worship": "İbadət yeri",
    "beach": "Çimərlik",
    "settlement": "Yaşayış məntəqəsi",
    "area": "Ərazi",
    "residential": "Yaşayış kompleksi",
}
# The shops people travel to: the rest (corner shops, bakeries, butchers, car parts,
# hairdressers) are many, alike and near everyone.
SHOPS = {
    "electronics", "mobile_phone", "computer", "appliance", "hifi", "clothes", "shoes", "bag",
    "boutique", "fashion_accessories", "jewelry", "watches", "cosmetics", "perfumery",
    "furniture", "interior_decoration", "houseware", "kitchen", "bed", "carpet", "lighting",
    "doityourself", "garden_centre", "books", "stationery", "toys", "baby_goods", "sports",
    "outdoor", "bicycle", "music", "musical_instrument", "gift", "optician", "pet",
    "variety_store", "car", "motorcycle", "fabric", "video_games", "photo", "art", "wholesale",
}
# Names that only say what a place is, as the search folds them (fold() below: й is и).
GENERIC = {
    "кафе", "магазин", "аптека", "мужскои салон", "чаихана", "чаихана кальянная", "шашлычная",
    "abide", "aptek", "apteka", "atelye", "avtovagzal", "ayaqqabi", "bag", "bank", "bar",
    "bazar", "belediyye", "berber", "berberxana", "cafe", "carousel", "cayxana", "cay evi",
    "cimerlik", "dayanacaq", "defterxana", "dua evi", "elektrik yarimstansiya", "etriyyat",
    "fotoatelye", "geyim", "hamam", "hostel", "hotel", "huquqsunas", "icra numayendeliyi",
    "idman kompleksi", "idman zali", "insaat mallari", "insaat materiallari", "kafe",
    "kilse", "kisi geyimi", "kitabxana", "klinika", "kollec", "kottec", "landed property",
    "magaza", "market", "medeniyyet evi", "mehmanxana", "meiset avadanligi", "mebel",
    "mebel salonu", "mekteb", "mescid", "minimarket", "mini market", "musiqi mektebi",
    "notarius", "otel", "park", "parkinq", "poct", "polis", "polis bolmesi",
    "polis menteqesi", "polis sobesi", "poliklinika", "prayer room", "qadin geyimi",
    "qeyri yasayis saheleri", "qeyri yasayis sahesi",
    "qonaq evi", "restaurant", "restoran", "stadion", "supermarket", "tecili tibbi yardim",
    "ticaret merkezi", "ticaret sirasi", "tibb menteqesi", "tikinti mallari",
    "tikinti materiallari", "trenajor", "tualet", "universitet", "usaq bagcasi",
    "usaq geyimi", "xestexana", "yataqxana", "zoo magaza", "zoo market",
}
# A building's word and its number, or the word alone ("Bina 1", "Корпус № 2", "ev 111a"),
# as fold() writes it.
NUMBERED = re.compile(r"^(?:bina|blok|block|korpus|building|корпус|блок|дом|здание|ev)(?: \d+[a-z]?)?$")
# Someone's home or flat, which nobody else travels to (private_home()), by its names as
# fold() writes them. A flat's number, in any place's name ("...8-mertebe 376-menzil",
# "28 квартира дом 25"):
FLAT = re.compile(r"(?:^| )(?:\d+[a-z]? (?:menzil|квартира)|(?:menzil|квартира) \d+)(?: |$)")
# A lodging named for a flat or a let ("Kirayə", "Kirayə Mənzil", "аренда квартиры"):
LET = re.compile(r"(?:^| )(?:kiraye\w*|icare\w*|menzil\w*|kvartir\w*|квартир\w*|аренд\w*|сда[её]\w*|"
                 r"посуточ\w*)(?: |$)")
# A lodging named a person's home, the home's word after one or two others ("Vahid ev",
# "Mustafa müəllimin evi", "Amir's home", "Saray evim", my home in Saray), when none of its
# names is a lodging's and it has no tag a business has:
HOME = re.compile(r"^(?:\S+ ){1,2}(?:ev|evi|evim|home)$")
LODGING = re.compile(r"(?:^| )(?:hotel\w*|otel\w*|hostel\w*|motel\w*|inn|guest\w*|qonaq|suites?|apart\w*|villa\w*|"
                     r"resort|istirahet|sanatori\w*|yataqxana\w*|kottec\w*|cottage\w*|отел\w*|гостини\w*|гостев\w*|"
                     r"хостел\w*|мотел\w*)(?: |$)")
BUSINESS = {"website", "url", "phone", "mobile", "email", "fax", "opening_hours", "stars", "rooms", "beds", "brand",
            "operator", "facebook", "instagram"}  # and contact:* and payment:*
# A residence's fenced grounds mapped as a park ("President's Residence", "İqamətgah"):
RESIDENCE = re.compile(r"(?:^| )(?:residence|rezidens\w*|iqametgah\w*|резиденц\w*)(?: |$)")
# A bus depot mapped as a bus station, by a word of its own name ("Baku Bus Depo", a motor
# transport yard's "Avtonəqliyyat Təsərrüfatı"): where buses are kept, not boarded.
DEPOT = re.compile(r"(?:^| )(?:depo\w*|депо|depot\w*|avtobaza\w*|автобаз\w*|avtopark\w*|автопарк\w*|qaraj\w*|"
                   r"garage\w*|гараж\w*|avtoneqliyyat\w*)(?: |$)")
# Categories whose names are proper names however plain they look ("Avtovağzal" station).
KEEP_PLAIN_NAMES = {"metro", "rail", "settlement", "area"}
# Larger features are mapped as a node and an outline further apart.
DUPLICATE_KM = {"settlement": 5.0, "area": 1.5, "residential": 1.0, "park": 1.0, "beach": 1.0}
DUPLICATE_KM_DEFAULT = 0.3
# An outline this long across (its bounding box's diagonal) is named by the build: an
# airfield's centre, for one, is in the middle of its runways.
LARGE_KM = 2.0
NAME_TAGS = ("name", "name:az", "name:ru", "name:en", "alt_name", "alt_name:az", "alt_name:ru",
             "old_name", "old_name:az", "old_name:ru", "short_name", "short_name:az",
             "official_name", "official_name:az", "brand", "brand:az")
# What a person decided after reading the data: (feature, tag, the value as mapped, the
# value used instead or None to leave it out, why). The tag "*" leaves out the whole
# feature, and its value is the feature's name. The build stops on a correction whose
# value OpenStreetMap no longer has, or whose feature it no longer has.
CORRECTIONS = [
    ("n3755614407", "name:en", "Heydar Aliyev mafia boss grave", None,
     "vandalism: the English name of Heydar Aliyev's grave, in the Alley of Honour, insults him"),
    ("w630137385", "*", "Корупс № 1", None,
     "the first of a university's numbered buildings, misspelt; NUMBERED leaves out Корпус № 2 to 5"),
    ("w630137386", "*", "Зал ручных игр", None,
     "a hall among those numbered buildings (\"hall of ball games\"), mapped as a university"),
    # A word in two alphabets cannot be typed on either keyboard (mixed() names them).
    ("n4481359889", "name", "Araя Market / Babək", "Araz Market / Babək",
     "typed in the Russian keyboard layout, where я is z; its website is arazmarket.az"),
    ("n9943368707", "name", "Leon Palaсу Şadlıq Sarayı", "Leon Palace Şadlıq Sarayı",
     "typed in the Russian keyboard layout, where с and у are c and e"),
    ("n4212308706", "name", "Lotos Ticarət Mərkəzi \\ 8-сш ль", "Lotos Ticarət Mərkəzi \\ 8-ci km",
     "typed in the Russian keyboard layout, where сш ль is ci km: the 8-ci km district"),
    ("n3950438053", "name:ru", "Бакe-Пассажирская", "Баку-Пассажирская",
     "typed in the Latin layout, where e is у: Baku's central station"),
    ("n11750428580", "name", "У DЯDИ МАКСА", "У ДЯДИ МАКСА", "a Latin D for the Cyrillic Д"),
    ("n10832269743", "name", "Tomponaj vэ Neft Layları İdarəsi", "Tomponaj və Neft Layları İdarəsi",
     "the Cyrillic э for ə"),
    ("n13785626480", "name:ru", "Kнижное кафе", "Книжное кафе", "a Latin K for the Cyrillic К"),
    ("n2629778353", "name:ru", "Tехнический Колледж", "Технический Колледж", "a Latin T for the Cyrillic Т"),
    ("n12531251832", "*", "random market", None,
     "a test record: its street and house number are \"random\", its postcode 1234 and its phone 789789789"),
    ("w1061503217", "*", "Azqranata Ticarət Mərkəzi Depo", None,
     "a trade centre's depot, a warehouse, mapped as a mall"),
    ("w1061503218", "*", "Bazarstore MMC Depo", None, "a supermarket chain's depot, a warehouse, mapped as a mall"),
    # Private gardens and homes mapped as parks or a garden, which private_home() cannot
    # tell by their names: without that tag, no category takes them.
    ("w1074314421", "leisure", "park", None, "a villa's plot of 54 by 114 m in the Novxanı dachas"),
    ("w433838315", "leisure", "garden", None, "a garden of 26 by 42 m in the Novxanı dachas, named after its owner"),
    ("n12950186425", "leisure", "park", None,
     "someone's home: its house number is its owner's house, and its name Russian for at home"),
    ("n13438559652", "leisure", "park", None,
     "a private place (operator:type=private) named after the account that mapped it"),
    ("n13766712519", "leisure", "park", None, "a family's garden, named after a person"),
]
# Outlines placed at a feature inside them rather than at their centre: (the feature it
# is placed at, why). The build stops if either is missing from the answer, or the one is
# not inside the other's bounding box.
PLACED_AT = {
    "w163717459": ("w372129341", "the airport's outline is 4 by 6 km and its centre is on the airfield, "
                                 "1 km from any stop; Terminal 1, its international terminal, is where "
                                 "the H1 bus starts"),
}
# Other names people search a well-known place by that OpenStreetMap does not have:
# (the names, where they are used). The build stops if a feature named here is missing.
ALIASES = {
    "w163717459": (["Aeroport", "Hava limanı", "Airport", "Аэропорт"],
                   "Baku's one passenger airport is the airport: the places around it are mapped as "
                   "VIP terminal Aeroport, Şeraton Aeroport, Aeroport Poliklinikası and ABB Aeroport"),
    "w479865023": (["BDU", "БГУ"], "Bakı Dövlət Universiteti's own abbreviation (bsu.edu.az) and its Russian one"),
    "r3983666": (["ADNSU", "ASOIU", "Neft Akademiyası"],
                 "the university's abbreviations in Azerbaijani and English (asoiu.edu.az), and its name "
                 "until 2015, Azərbaycan Dövlət Neft Akademiyası"),
    "w32720577": (["Qafqaz Universiteti", "BMU"],
                  "Qafqaz University's campus in Xırdalan became Bakı Mühəndislik Universiteti in 2016 "
                  "(beu.edu.az), and BMU is its abbreviation"),
    "w340060268": (["Alov Qüllələri", "Пламенные башни"], "the towers' Azerbaijani and Russian names"),
    "r19380164": (["Heydar Aliyev Center", "Heydar Aliyev Centre"],
                  "the centre's own English name (heydaraliyevcenter.az); OpenStreetMap's is "
                  "\"Center of Heydar Aliev\""),
    # The metro stations whose OpenStreetMap node has no Russian name, by the Russian names
    # they go by ("Список станций Бакинского метрополитена", ru.ruwiki.ru).
    "n1930089762": (["20 Января"], "the Russian name of the station 20 Yanvar"),
    "n5188836356": (["28 Мая"], "the Russian name of the station 28 May"),
    "n6010348738": (["8 Ноября"], "the Russian name of the station 8 Noyabr"),
    "n4168101319": (["Автовокзал"], "the Russian name of the station Avtovağzal"),
    "n2295524457": (["Джафар Джаббарлы"], "the Russian name of the station Cəfər Cabbarlı"),
    "n11622641264": (["Гянджлик"], "the Russian name of the station Gənclik"),
    "n14255299687": (["Ходжасан"], "the Russian name of the station Xocəsən"),
}
# Word starts a person reads every name and other name for at each refresh, as fold()
# writes them (no diacritics, й as и): insults, profanity, crime and politics, in English,
# Azerbaijani and Russian.
REVIEW = re.compile(
    "(?:^| )(?:"
    r"mafi|thie[fv]|crook|criminal|murder|killer|dictator|tyrant|regime|corrupt|terroris|nazi\b|nazis|"
    r"fascis|shit|fuck|bitch|cunt|dick\b|whore|slut|porn|idiot|stupid|moron|traitor|"
    r"ogru|qatil|diktator|rejim\b|terrorcu|fasist|ogras|qehbe|fahise|peyser|gotveren|dalbayob|amciq|"
    r"axmaq|satqin|xain\b|rusvet|"
    r"мафи|вор\b|вора\b|воры\b|убийц|диктатор|режим|коррупц|террорист|фашист|нацист|ху[иея]|пизд|"
    r"еба[нлт]|бляд|блят|сука\b|суки\b|мудак|мудил|гандон|дерьм|говн|жоп|шлюх|пидор|пидар|дебил|"
    r"идиот|урод|тварь|мраз|сволоч|предател"
    ")")
SCHWA = re.compile("[\u04d9\u04d8]")  # Cyrillic schwas, typed for the Latin letter
CYRILLIC = re.compile("[\u0400-\u04ff]")
LATIN = re.compile("[A-Za-z\u00c0-\u024f\u0259]")
APOSTROPHES = re.compile("['`\u00b4\u02bc\u2018\u2019]")


def km(a, b):
    """Great-circle distance in km between two (lat, lon) points."""
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def fold(value):
    """A name as the planner's search compares it (src/lib/busroute/searchText.ts): lower
    case, Azerbaijani letters on a Latin keyboard (ə and the Cyrillic ә as e, ı as i, other
    marks dropped), Cyrillic kept, apostrophes dropped ("John's" is one word), everything
    else a space."""
    value = value.replace("İ", "i").replace("I", "ı").lower()
    value = value.replace("ə", "e").replace("\u04d9", "e").replace("ı", "i")
    value = "".join(c for c in unicodedata.normalize("NFD", value) if not unicodedata.combining(c))
    value = APOSTROPHES.sub("", value)
    return " ".join(re.sub("[^a-z0-9\u0430-\u044f]+", " ", value).split())


def tidy(name):
    """A name as shown: single spaces, "Name \\ Place" as "Name / Place", and a Cyrillic
    schwa inside a Latin name as the Latin letter."""
    name = " ".join(re.sub(r"(?:\s*\\\s*)+", " / ", name).split()).strip(" /")
    if re.search("[A-Za-z]", name) and not CYRILLIC.search(SCHWA.sub("", name)):
        name = SCHWA.sub(lambda m: "\u0259" if m.group() == "\u04d9" else "\u018f", name)
    return name


def own_names(t):
    """Every name of a feature with tags `t` as fold() writes it, without the place the
    mappers add after it ("Lotos Ticarət Mərkəzi \\ 8-ci km"), as placeMatch.ts's
    ownWords leaves it out."""
    return [f for key in NAME_TAGS for v in (t.get(key) or "").split(";")
            if (f := fold(tidy(v).split(" / ")[0]))]


def category(t):
    """The category of a feature with tags `t`, or None if the planner does not offer it."""
    amenity, shop, tourism, leisure = t.get("amenity"), t.get("shop"), t.get("tourism"), t.get("leisure")
    healthcare, office, building, place = t.get("healthcare"), t.get("office"), t.get("building"), t.get("place")
    station = t.get("railway") in ("station", "halt") or t.get("public_transport") == "station"
    if station and (t.get("station") == "subway" or t.get("subway") == "yes"):
        return "metro"
    if t.get("station") == "funicular":
        return "sight"
    # No passenger flies from a military airfield (Qala Aerodromu, the Kala air base) or an
    # abandoned one.
    if t.get("aeroway") in ("aerodrome", "terminal") and not (
            t.get("military") or t.get("landuse") == "military" or t.get("aerodrome:type") == "military"
            or "abandoned:aeroway" in t or "disused:aeroway" in t):
        return "airport"
    if amenity == "ferry_terminal" or t.get("railway") == "ferry_terminal":
        return "port"
    if amenity == "bus_station" or (station and t.get("bus") == "yes"):
        # A platform is part of a station, and a depot (DEPOT) is where buses are kept.
        platform = amenity == "bus_station" and t.get("public_transport") == "platform"
        return None if platform or any(DEPOT.search(n) for n in own_names(t)) else "bus_station"
    if station:
        return "rail"
    if shop in ("mall", "department_store") or t.get("landuse") == "retail":
        return "mall"
    if amenity == "marketplace":
        return "market"
    if shop == "supermarket":
        return "supermarket"
    if amenity in ("restaurant", "fast_food", "food_court"):
        return "restaurant"
    if amenity in ("cafe", "ice_cream"):
        return "cafe"
    if tourism in ("hotel", "motel", "hostel", "guest_house") or building == "hotel":
        return "hotel"
    if amenity == "university" or building == "university":
        return "university"
    if amenity == "college" or building == "college":
        return "college"
    if amenity == "school" or building == "school":
        return "school"
    if amenity == "kindergarten" or building == "kindergarten":
        return "kindergarten"
    if amenity == "hospital" or healthcare == "hospital" or building == "hospital":
        return "hospital"
    if amenity == "clinic" or healthcare in ("clinic", "centre"):
        return "clinic"
    if office == "diplomatic" or amenity == "embassy":
        return "embassy"
    if (office == "government" or amenity in ("townhall", "courthouse", "police", "public_building")
            or building in ("government", "public", "civic")):
        return "government"
    if amenity == "post_office":
        return "post_office"
    if amenity == "bank":
        return "bank"
    if tourism in ("museum", "gallery"):
        return "museum"
    if amenity in ("theatre", "cinema", "concert_hall"):
        return "theatre"
    if amenity in ("arts_centre", "community_centre", "library", "events_venue", "events_centre",
                   "conference_centre", "exhibition_centre"):
        return "culture"
    if amenity == "place_of_worship" or building in ("mosque", "church", "cathedral", "synagogue"):
        return "worship"
    if tourism in ("theme_park", "zoo", "aquarium") or leisure in (
            "water_park", "amusement_arcade", "bowling_alley", "trampoline_park", "indoor_play", "escape_game"):
        return "fun"
    if leisure in ("sports_centre", "fitness_centre", "sports_hall", "stadium", "swimming_pool", "ice_rink",
                   "golf_course") or building in ("stadium", "sports_hall"):
        return "sport"
    if t.get("natural") == "beach" or leisure == "beach_resort":
        return "beach"
    if leisure in ("park", "garden"):
        return "park"
    if place == "square":
        return "square"
    if (tourism in ("attraction", "artwork", "viewpoint", "memorial", "architecture", "historic_house")
            or t.get("historic") in ("memorial", "monument", "castle", "fort", "palace", "city_gate",
                                     "caravanserai", "archaeological_site", "mosque", "building", "tower")
            or t.get("natural") == "volcano"):
        return "sight"
    if shop in SHOPS:
        return "shop"
    if office or building in ("office", "commercial") or t.get("landuse") == "commercial":
        return "office"
    if place in ("city", "town", "village", "hamlet", "suburb"):
        return "settlement"
    if place in ("quarter", "neighbourhood", "city_block", "locality", "island", "islet"):
        return "area"
    if t.get("landuse") == "residential" or building in ("apartments", "residential"):
        return "residential"
    return None


def names(t):
    """(the name shown, [the other names searched]) for tags `t`, or None. A tag can hold
    several names apart by ";": the first of name:az, else of name, is the one shown."""
    def values(key):
        return [v for v in (tidy(v) for v in (t.get(key) or "").split(";")) if fold(v)]
    az, local = values("name:az"), values("name")
    if not az and not local:
        return None
    shown = (az or local)[0]
    if CYRILLIC.search(shown) and local and not CYRILLIC.search(local[0]):
        shown = local[0]  # a Russian name:az, where name is Azerbaijani
    seen, others = {fold(shown)}, []
    for key in NAME_TAGS:
        for value in values(key):
            if fold(value) not in seen:
                seen.add(fold(value))
                others.append(value)
    return shown, others


def plain(name):
    """Whether a name says only what the place is, is a building's number, or has no
    letters. A cash machine ("Kapital Bank ATM") is not a bank one can go into either."""
    words = fold(name).split()
    return (" ".join(words) in GENERIC or bool(NUMBERED.match(" ".join(words)))
            or sum(c.isalpha() for c in name) < 2 or "atm" in words)


def private_home(category, t, names):
    """Whether a place of `category` with tags `t` and `names` (the shown one and the
    others) is someone's home or flat, which nobody else travels to: a flat's number in a
    name (FLAT); a lodging named a dacha ("дача друга рашида", a friend's dacha), a flat or
    a let (LET), or a person's home (HOME) when none of its names is a lodging's and it has
    no tag a business has (a website, a phone, opening hours, stars, rooms); or a
    residence's fenced grounds mapped as a park (RESIDENCE)."""
    folded = [fold(n) for n in names]
    if any(FLAT.search(f) for f in folded):
        return True
    if category == "hotel":
        if any("дача" in f.split() or LET.search(f) for f in folded):
            return True
        business = any(k in BUSINESS or k.startswith(("contact:", "payment:")) for k in t)
        return any(HOME.match(f) for f in folded) and not any(LODGING.search(f) for f in folded) and not business
    return category == "park" and t.get("barrier") in ("fence", "wall") and any(RESIDENCE.search(f) for f in folded)


def mixed(name):
    """The words of a name in both alphabets ("Araя"), which neither keyboard can type."""
    return [w for w in re.findall(r"[^\W\d_]+", name) if LATIN.search(w) and CYRILLIC.search(w)]


def notable(t):
    """Whether a feature has a Wikidata or Wikipedia entry: the search puts it first among
    equally good matches."""
    return "wikidata" in t or "wikipedia" in t


def point(element):
    where = element.get("center") or element
    return (round(where["lat"], 5), round(where["lon"], 5))


def in_bbox(p):
    south, west, north, east = BBOX
    return south <= p[0] <= north and west <= p[1] <= east


def correct(elements):
    """The features with CORRECTIONS applied, and the corrections whose value OpenStreetMap
    no longer has (or whose feature it no longer has)."""
    todo, applied, out = {}, set(), []
    for c in CORRECTIONS:
        todo.setdefault(c[0], []).append(c)
    for e in elements:
        tags, whole = dict(e["tags"]), False
        for c in todo.get(e["type"][0] + str(e["id"]), []):
            _, tag, value, use, _ = c
            if tags.get("name" if tag == "*" else tag) != value:
                continue
            applied.add(c)
            if tag == "*":
                whole = True
            elif use is None:
                del tags[tag]
            else:
                tags[tag] = use
        if not whole:
            out.append({**e, "tags": tags})
    return out, [c for c in CORRECTIONS if c not in applied]


def place_at(places, elements, bounds):
    """Move the places PLACED_AT names to the feature inside them."""
    by_id = {p["id"]: p for p in places}
    where = {e["type"][0] + str(e["id"]): point(e) for e in elements}
    for place_id, (inside, _) in PLACED_AT.items():
        b = bounds.get(place_id)
        if place_id not in by_id or inside not in where or b is None:
            sys.exit(f"PLACED_AT: {place_id} or {inside} is missing from the answer")
        lat, lon = where[inside]
        if not (b["minlat"] <= lat <= b["maxlat"] and b["minlon"] <= lon <= b["maxlon"]):
            sys.exit(f"PLACED_AT: {inside} is not inside {place_id}'s outline")
        by_id[place_id]["point"] = where[inside]


def add_aliases(places):
    """Add ALIASES to the places; return the ids it names that no place has."""
    by_id, missing = {p["id"]: p for p in places}, []
    for place_id, (extra, _) in ALIASES.items():
        place = by_id.get(place_id)
        if place is None:
            missing.append(place_id)
            continue
        seen = {fold(n) for n in [place["name"], *place["aliases"]]}
        for name in extra:
            if fold(name) not in seen:
                seen.add(fold(name))
                place["aliases"].append(name)
    return missing


def to_review(places):
    """Each name and other name with a word from REVIEW, with its place."""
    return [f"{n} ({p['category']} {p['id']}{'' if n == p['name'] else ', other name of ' + p['name']})"
            for p in places for n in [p["name"], *p["aliases"]] if REVIEW.search(fold(n))]


def metro_places(elements):
    """The planner's 27 metro stations, each with the other names of the OpenStreetMap
    station it matches: one of the same name (less a trailing "st." or "-2"), the nearest
    within 500 m that no other station took."""
    stations = json.loads(METRO.read_text(encoding="utf-8"))["stations"]
    osm = [e for e in elements if category(e["tags"]) == "metro"]
    used, out = set(), []
    for station in stations:
        at = (station["latitude"], station["longitude"])
        base = fold(re.sub(r"-2$", "", station["name"]))
        matches = sorted((km(at, point(e)), e["type"][0] + str(e["id"]), e) for e in osm
                         if re.sub(r" st$", "", fold(e["tags"]["name"])) == base and e["id"] not in used)
        if not matches or matches[0][0] > 0.5:
            sys.exit(f"metro.json's {station['name']} matches no OpenStreetMap station within 500 m")
        _, osm_id, element = matches[0]
        used.add(element["id"])
        shown, others = names(element["tags"])
        others = [n for n in [shown, *others] if fold(n) != fold(station["name"])]
        out.append({"id": osm_id, "name": station["name"], "category": "metro", "point": at,
                    "notable": notable(element["tags"]), "aliases": others})
    return out


def dedupe(places):
    """Merge features of one category and one name within DUPLICATE_KM of each other."""
    groups = {}
    for p in places:
        groups.setdefault((p["category"], fold(p["name"])), []).append(p)
    out = []
    for (cat, _), members in groups.items():
        limit = DUPLICATE_KM.get(cat, DUPLICATE_KM_DEFAULT)
        members.sort(key=lambda p: (p["id"][0] != "n", -len(p["aliases"]), int(p["id"][1:])))
        kept = []
        for p in members:
            home = next((k for k in kept if km(k["point"], p["point"]) <= limit), None)
            if home is None:
                kept.append(p)
                continue
            home["notable"] = home["notable"] or p["notable"]
            seen = {fold(n) for n in [home["name"], *home["aliases"]]}
            for n in [p["name"], *p["aliases"]]:
                if fold(n) not in seen:
                    seen.add(fold(n))
                    home["aliases"].append(n)
        out += kept
    return out


def retry_after(value, attempt):
    """How many seconds to wait before trying again: Retry-After's, in seconds or as an
    HTTP date, else two minutes more for each attempt made."""
    value = (value or "").strip()
    if value.isdigit():
        return int(value) or 120 * attempt
    try:
        when = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return 120 * attempt
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(1, math.ceil((when - datetime.now(timezone.utc)).total_seconds()))


def fetch(path):
    """Send QUERY to Overpass once and save the answer as it came. A 429 (too many
    requests), 502 (all workers busy, as overpass-api.de answered on 2026-11-11) or 504
    (server busy) waits and tries again, at most twice more."""
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    for attempt in range(1, 4):
        request = urllib.request.Request(API, data=body, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_S + 120) as response:
                raw = response.read()
            break
        except urllib.error.HTTPError as error:
            if error.code not in (429, 502, 504) or attempt == 3:
                raise
            wait = retry_after(error.headers.get("Retry-After"), attempt)
            print(f"Overpass answered {error.code}; trying again in {wait} s", file=sys.stderr)
            time.sleep(wait)
    answer = json.loads(raw)
    remark = answer.get("remark", "")
    if "error" in remark.lower():
        sys.exit(f"Overpass did not finish the query: {remark}")
    Path(path).write_bytes(raw)
    print(f"saved {len(answer['elements'])} elements ({len(raw) / 1e6:.1f} MB), OpenStreetMap data of "
          f"{SNAPSHOT} read from a database of {answer['osm3s']['timestamp_osm_base']}, to {path}")


def build(path):
    raw = Path(path).read_bytes()
    answer = json.loads(raw)
    if "error" in answer.get("remark", "").lower():
        sys.exit(f"{path}: Overpass did not finish the query: {answer['remark']}")
    # When Overpass read it: a database older than SNAPSHOT cannot have answered for it.
    read = answer["osm3s"]["timestamp_osm_base"]
    if read < SNAPSHOT:
        sys.exit(f"{path}: read from a database of {read}, before the snapshot ({SNAPSHOT})")
    # The ways and relations come twice: with their tags and centre, then with their
    # bounding box alone (QUERY's last output).
    features = [e for e in answer["elements"] if "tags" in e]
    elements, stale = correct(features)
    if stale:
        sys.exit("CORRECTIONS whose value OpenStreetMap no longer has, to read and update or remove: "
                 + "; ".join(f"{c[0]} {c[1]} {c[2]!r}" for c in stale))
    bounds = {e["type"][0] + str(e["id"]): e["bounds"] for e in answer["elements"] if "bounds" in e}

    places, plain_names, homes, outside = [], Counter(), [], []
    for e in elements:
        t = e.get("tags", {})
        cat = category(t) if t.get("name") else None
        if cat is None or cat == "metro":
            continue
        named = names(t)
        if named is None:
            continue
        shown, others = named
        if cat not in KEEP_PLAIN_NAMES and plain(shown):
            plain_names[fold(shown)] += 1
            continue
        if private_home(cat, t, [shown, *others]):
            homes.append(f"{shown} ({cat} {e['type'][0]}{e['id']})")
            continue
        if not any(c.isalpha() for c in shown):
            continue
        if not in_bbox(point(e)):
            # A way or relation that reaches into the area from outside it.
            outside.append(shown)
            continue
        places.append({"id": e["type"][0] + str(e["id"]), "name": shown, "category": cat, "point": point(e),
                       "notable": notable(t), "aliases": others})
    place_at(places, elements, bounds)
    places = dedupe(places) + metro_places(elements)
    missing = add_aliases(places)
    if missing:
        sys.exit(f"ALIASES for features the answer does not have, to update or remove: {', '.join(missing)}")
    order = list(LABELS)
    places.sort(key=lambda p: (order.index(p["category"]), fold(p["name"]), p["id"]))

    source = {
        "data": "© OpenStreetMap contributors",
        "license": "Open Database License (ODbL) 1.0",
        "copyright": "https://www.openstreetmap.org/copyright",
        "snapshot": SNAPSHOT,
        "read": read[:10],
        "api": API,
        "query": QUERY,
        "answer_sha256": hashlib.sha256(raw).hexdigest(),
        "script": "scripts/bus/build_places_json.py",
    }
    def row(p):
        return json.dumps([p["id"], p["name"], p["category"], p["point"][0], p["point"][1], int(p["notable"]),
                           p["aliases"]], ensure_ascii=False, separators=(",", ":"))

    OUT.write_text("{\n" + ",\n".join([
        f'"source": {json.dumps(source, ensure_ascii=False)}',
        f'"labels": {json.dumps(LABELS, ensure_ascii=False)}',
        '"fields": ["id", "name", "category", "latitude", "longitude", "notable", "aliases"]',
        '"places": [\n' + ",\n".join("  " + row(p) for p in places) + "\n]",
    ]) + "\n}\n", encoding="utf-8")
    counts = Counter(p["category"] for p in places)
    print(f"wrote {OUT}: {len(places)} places ({OUT.stat().st_size / 1e6:.2f} MB) from "
          f"{len(features)} features of {source['snapshot']}; left out {sum(plain_names.values())} "
          f"with a plain name and {len(outside)} centred outside the area ({', '.join(outside)})")
    print("  " + ", ".join(f"{cat} {counts[cat]}" for cat in LABELS))
    print(f"  {len(homes)} homes and flats left out, to read for a place people go to (private_home()): "
          f"{', '.join(homes)}")
    # Settlements and areas are regions, whose centre is as good a point as any.
    large = sorted(((km((b["minlat"], b["minlon"]), (b["maxlat"], b["maxlon"])), p) for p in places
                    if (b := bounds.get(p["id"])) and p["id"] not in PLACED_AT
                    and p["category"] not in ("metro", "settlement", "area")),
                   key=lambda item: -item[0])
    large = [f"{p['name']} ({p['category']}, {d:.1f} km)" for d, p in large if d > LARGE_KM]
    print(f"  {len(large)} outlines over {LARGE_KM:g} km across, each at its centre: {', '.join(large)}")
    print(f"  {len(CORRECTIONS)} corrections applied, other names added to {len(ALIASES)} places (ALIASES)")
    review = to_review(places)
    print(f"  {len(review)} names to read for vandalism (REVIEW): {', '.join(review)}")
    slips = [f"{n} ({p['id']})" for p in places for n in [p["name"], *p["aliases"]] if mixed(n)]
    print(f"  {len(slips)} names with a word in both alphabets, to correct in CORRECTIONS: {', '.join(slips) or 'none'}")


def main(argv):
    if len(argv) == 3 and argv[1] == "--fetch":
        fetch(argv[2])
    elif len(argv) == 2 and not argv[1].startswith("-"):
        build(argv[1])
    else:
        sys.exit("usage: build_places_json.py --fetch <answer.json> | build_places_json.py <answer.json>")


if __name__ == "__main__":
    main(sys.argv)
