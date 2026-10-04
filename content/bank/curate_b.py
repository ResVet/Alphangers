# Patches for the 200-question file. Keyed by position (0-based) in the file.
# Most explanations stay as written. The ones rewritten were meta ("rangkuman menyatakan...",
# "file kedua mencantumkan...") or contradicted their own key.

def _topics():
    t = {}
    def put(rng, code):
        for i in rng: t[i] = code
    put(range(0, 4), 'min'); put(range(4, 9), 'bio'); t[9] = 'min'
    put(range(10, 18), 'bio'); t[18] = 'ana'; t[19] = 'fis'; put(range(20, 23), 'ana')
    t[23] = 'fis'; t[24] = 'fis'; put(range(25, 27), 'ana'); t[27] = 'fis'
    put(range(28, 38), 'saraf'); put(range(38, 63), 'org'); t[63] = 'bio'; put(range(64, 68), 'org')
    put(range(68, 78), 'ling'); put(range(78, 88), 'org'); put(range(88, 93), 'prot')
    put(range(93, 98), 'ab'); put(range(98, 100), 'ana'); t[100] = 'ab'; t[101] = 'ana'; t[102] = 'ana'
    put(range(103, 108), 'ana'); put(range(108, 111), 'ab'); put(range(111, 115), 'fis'); t[115] = 'ana'
    put(range(116, 118), 'ana'); put(range(118, 128), 'prot'); t[128] = 'min'; put(range(129, 133), 'bio')
    t[133] = 'ab'; t[134] = 'bio'; t[135] = 'saraf'; t[136] = 'saraf'; t[137] = 'ling'; put(range(138, 140), 'fis')
    put(range(140, 142), 'prot'); t[142] = 'ab'; put(range(143, 147), 'fis'); put(range(147, 151), 'ab')
    t[151] = 'fis'; put(range(152, 154), 'tek'); t[154] = 'fis'; put(range(155, 157), 'tek'); put(range(157, 163), 'fis')
    put(range(163, 170), 'tek'); t[170] = 'ling'; t[171] = 'ab'; t[172] = 'min'; t[173] = 'min'; t[174] = 'bio'; t[175] = 'tek'
    t[176] = 'org'; t[177] = 'bio'; t[178] = 'saraf'; t[179] = 'ana'; t[180] = 'ab'; put(range(181, 185), 'ling')
    put(range(185, 190), 'fis'); t[190] = 'ling'; put(range(191, 200), 'saraf')
    return t

TOPIC_B = _topics()

# Duplicates of kept items: B071=A30, B075=A46, B171=A17, B172=A95, B161 repeats B162
DROP_B = {71, 75, 161, 171, 172}

B = {
13: dict(a=[1, 2], e='Kelarutan asam lemak di air makin rendah kalau rantai hidrokarbonnya makin panjang dan ikatan rangkapnya makin sedikit, karena keduanya membuat molekul makin hidrofobik.',
  note='Kunci file asli hanya C. Menurut Lehninger, jumlah ikatan rangkap yang makin sedikit juga menurunkan kelarutan, jadi B ikut dihitung benar.'),
22: dict(o=['Hanya dalam pelarut organik', 'Hanya dalam air', 'Konsentrasinya sama pada kedua pelarut', 'Tidak terlarut']),
25: dict(q='Jika zat nonpolar diekstraksi dengan pelarut air, hasil ekstraksinya…'),
73: dict(e='Di antara pilihan, hanya C yang masuk akal dan kuncinya mengikuti materi. Perlu dicatat, pada kadar CO2 ruangan yang biasa, keluhan pusing dan sulit konsentrasi lebih banyak disebabkan penumpukan CO2 itu sendiri (hiperkapnia ringan) daripada kekurangan O2.'),
79: dict(q='Dietil eter kini jarang dipakai sebagai anestesi inhalasi karena mudah terbakar dan meledak.', a=[0],
  e='Eter efektif sebagai anestesi, tapi uapnya sangat mudah terbakar dan bisa meledak di ruang operasi. Karena itu eter digantikan anestesi inhalasi yang tidak mudah terbakar.',
  note='Pernyataan di file asli memakai etuna dengan kunci "Salah", padahal anestesi asetilena (etuna) memang ditinggalkan karena bahaya ledakan. Pernyataannya dikembalikan ke eter, sesuai pembahasan file aslinya.'),
174: dict(q='Monosakarida yang memiliki struktur furanosa adalah…', o=['Fruktosa', 'Glukosa', 'Manosa', 'Sukrosa'],
  e='Fruktosa (ketoheksosa) membentuk cincin lima anggota atau furanosa, karena gugus keton di C2 bereaksi dengan gugus OH di C5. Glukosa dan manosa umumnya membentuk cincin piranosa, sedangkan sukrosa adalah disakarida.'),
189: dict(q='Seorang pasien berada di ruangan bersuhu 10 °C. Tubuhnya menggigil dan terjadi vasokonstriksi. Respon ini merupakan contoh…',
  o=['Hukum ke-0 Termodinamika', 'Homeostasis fisiologis terhadap dingin', 'Hukum I Termodinamika', 'Radiasi panas', 'Konduksi']),

14: dict(a=[2, 3], e='Glikolipid tersusun dari lipid dan karbohidrat, jadi termasuk lipid kompleks. Di banyak buku kelompok ini juga disebut lipid terkonjugasi atau lipid majemuk.',
  note='Lipid kompleks dan lipid terkonjugasi adalah sebutan untuk kelompok yang sama, jadi keduanya dihitung benar. Kunci file asli: lipid kompleks.'),
91: dict(e='Banyak protease disekresikan sebagai zimogen (bentuk inaktif), misalnya pepsinogen dan tripsinogen, supaya tidak mencerna sel yang membuatnya.'),
97: dict(q='Perubahan fraksi HCO3⁻ menunjukkan asidosis atau alkalosis respiratorik.', e='Perubahan HCO3⁻ terutama menandakan gangguan metabolik. Gangguan respiratorik ditandai perubahan PCO2.'),
119: dict(e='Protein manusia disusun dari asam amino konfigurasi L.'),
139: dict(e='Sel kerucut (cone) bekerja di cahaya terang dan bertanggung jawab atas penglihatan warna serta ketajaman. Sel batang lebih peka untuk cahaya redup.'),
4: dict(e='Peran utama karbohidrat adalah sumber energi dan komponen struktural. Karbohidrat di permukaan sel memang ikut berperan dalam pengenalan sel, tapi itu bukan peran utamanya.'),
8: dict(e='Kitosan memang polisakarida alami yang bisa dibuat menjadi nanopartikel pembawa obat.'),
20: dict(o=['20-30°C', '60-70°C', '90-95°C', '120°C'], e='Dekokta dibuat dengan memanaskan simplisia dalam air mendekati titik didih, sekitar 90-95°C.'),
23: dict(e='Gerak Brown adalah gerakan acak zig-zag partikel koloid akibat tumbukan dengan molekul medium pendispersinya.'),
38: dict(e='Kopling garam diazonium dengan fenol memerlukan suasana basa untuk membentuk pewarna azo.'),
39: dict(e='Hasil positif uji diazo berupa warna merah sampai jingga dari senyawa azo yang terbentuk, bukan biru pekat.'),
40: dict(e='Uji iodoform positif untuk senyawa dengan gugus metil keton (CH3-CO-) atau alkohol yang bisa teroksidasi menjadi gugus itu. Fruktosa tidak punya gugus tersebut, jadi tidak memberi endapan iodoform yang khas.'),
44: dict(e='Hasil positif Marquis pada guaifenesin berupa warna ungu sampai merah keunguan, bukan kuning pucat.'),
46: dict(e='Alkohol mudah terbakar, jadi pemanasannya memakai penangas air, bukan api langsung.'),
57: dict(q='Reaksi ninhidrin pada amoksisilin dilakukan dengan pemanasan penangas air sekitar 80-100°C.',
  e='Ninhidrin baru bereaksi dengan gugus amina primer amoksisilin setelah dipanaskan, dan hasil positifnya berwarna ungu. Penangas air di suhu itu adalah prosedur di penuntun praktikum.'),
60: dict(e='Menurut penuntun praktikum, uji natrium ini memakai asam pikrat, bukan asam oksalat. Kristal yang terbentuk memang diamati di bawah mikroskop.'),
61: dict(e='Endapan merkuro klorida (Hg2Cl2) tidak larut dalam amonia. Endapannya justru berubah hitam karena terbentuk Hg dan HgNH2Cl. Endapan yang larut dalam amonia karena membentuk kompleks adalah AgCl, menjadi [Ag(NH3)2]⁺.'),
62: dict(e='H2SO4 pekat dialirkan lewat dinding tabung karena sangat korosif dan melepaskan banyak panas saat bercampur dengan air, bukan karena mudah membeku.'),
64: dict(e='Uji Seliwanoff perlu pemanasan. Ketosa seperti fruktosa terdehidrasi lebih cepat menjadi hidroksimetilfurfural, lalu memberi warna merah dengan resorsinol.'),
67: dict(q='Endapan merah-oranye di dasar tabung menunjukkan adanya gula pereduksi, misalnya maltosa atau laktosa.', e='Endapan merah-oranye adalah Cu2O, tanda adanya gula pereduksi. Maltosa dan laktosa termasuk disakarida pereduksi karena masih punya gugus karbonil bebas.'),
74: dict(e='Kebisingan kronis adalah stresor yang mengaktifkan sumbu HPA (hipotalamus-hipofisis-adrenal). Kortisol yang terus tinggi mengganggu metabolisme glukosa dan lemak. Aktivasi simpatis juga terjadi, tapi jalur yang dikaitkan dengan gangguan metabolik di materi ini adalah HPA.'),
76: dict(e='Lux adalah satuan kuat penerangan (iluminansi), yaitu banyaknya cahaya yang jatuh per satuan luas permukaan. Di materi K3 besaran ini disebut intensitas cahaya.'),
77: dict(q='Kenaikan kebisingan sebesar 10 dB(A) dikaitkan dengan peningkatan insiden penyakit jantung koroner sebesar…',
  e='Angka 12% per kenaikan 10 dB(A) mengikuti materi kuliah. Sebagai pembanding, pedoman kebisingan WHO 2018 memakai kenaikan risiko sekitar 8% per 10 dB, jadi untuk ujian ikuti angka di materi.'),
78: dict(e='Kadar etanol untuk antiseptik yang diajarkan di materi adalah 70%. Air di dalamnya membantu denaturasi protein mikroba dan memperlambat penguapan.',
  note='Kunci mengikuti materi (etanol 70%). Di praktik, kadar lain seperti 80% juga dipakai, misalnya pada formula hand rub WHO.'),
81: dict(e='Asam karboksilat (gugus -COOH) adalah asam lemah, bukan basa.'),
82: dict(e='Urea, CO(NH2)2, adalah senyawa amida: gugus karbonil yang mengikat dua gugus amina. Eter punya gugus R-O-R\'.'),
85: dict(e='Kadar vitamin C ditentukan dengan titrasi redoks (misalnya iodimetri) karena vitamin C adalah reduktor. Reaksi substitusi tidak dipakai untuk ini.'),
88: dict(e='Tanpa enzim, hidrolisis ikatan peptida berlangsung sangat lambat. Enzim protease yang membuatnya cepat.'),
90: dict(e='Proteasom adalah kompleks protein besar (protease multisubunit) yang memecah protein berlabel ubikuitin. Ia tidak mengandung RNA, jadi bukan riboprotein.'),
96: dict(e='pH darah normal sedikit basa, yaitu 7,35-7,45.'),
104: dict(e='Jenis spektrofotometri lebih dari dua, antara lain UV, visibel, UV-Vis, inframerah (IR), serapan atom (AAS), dan fluoresensi.'),
105: dict(q='Panjang gelombang UV adalah 190-380 nm.', e='Rentang UV pada spektrofotometri sekitar 190-380 nm. Di atasnya adalah cahaya tampak, sekitar 380-780 nm.'),
110: dict(e='NaCl 0,9% adalah kristaloid yang secara umum dianggap isotonis terhadap plasma.'),
127: dict(e='pKa gugus imidazol histidin sekitar 6,0, cukup dekat dengan pH fisiologis. Jadi histidin justru buffer fisiologis yang baik, contohnya di hemoglobin.'),
128: dict(e='Klorida (Cl⁻) adalah bahan pembentuk HCl oleh sel parietal lambung dan ikut mengatur keseimbangan asam-basa lewat pertukaran klorida-bikarbonat.',
  note='Kunci mengikuti materi. Klausa "kelebihan klorida meningkatkan produksi asam lambung" juga dari materi; secara fisiologis kelebihan klorida lebih dikenal menyebabkan asidosis metabolik hiperkloremik.'),
143: dict(e='Diare akut berlangsung kurang dari 14 hari. Diare yang berlangsung 14 hari atau lebih disebut diare persisten.'),
147: dict(e='NaCl 0,9% isotonis terhadap plasma, jadi tidak menarik cairan dari sel ke pembuluh darah.'),
153: dict(e='Banyak pompa infus dan pengontrol tetesan memakai sensor optik atau inframerah yang mendeteksi setiap tetesan di drip chamber.'),
157: dict(a=[0],
  e='Saat manset dikempiskan dan tekanannya turun sampai setara tekanan sistolik, darah mulai bisa menyembur melewati arteri yang tertekan dan terdengar bunyi Korotkoff pertama. Itu sebabnya bunyi pertama dicatat sebagai tekanan sistolik.',
  note='Kunci di file asli "Salah", padahal pembahasan di file yang sama menjelaskan hal ini. Kuncinya dikoreksi ke "Benar".'),
160: dict(e='Menurut hukum Poiseuille, laju aliran sebanding dengan beda tekanan (ΔP) dan berbanding terbalik dengan viskositas.'),
163: dict(e='Pasien biasanya diminta puasa sekitar 6-8 jam sebelum USG abdomen supaya gas usus berkurang dan kandung empedu terisi, sehingga organ lebih jelas terlihat.'),
164: dict(q='Prinsip proteksi radiasi dalam radiologi adalah…',
  e='Paparan radiasi dikurangi dengan mempersingkat waktu, memperjauh jarak dari sumber, dan memakai perisai (shielding) seperti apron timbal.'),
165: dict(e='Pedometer di HP bekerja dari sensor gerak, jadi yang paling menentukan akurasinya adalah seberapa peka aplikasi mendeteksi tiap langkah kaki. Harga dan berat HP tidak memengaruhi hitungannya.'),
167: dict(q='Teknologi kedokteran yang digunakan untuk terapi penderita autisme adalah…',
  e='Kacamata augmented reality dipakai sebagai alat bantu terapi anak dengan autisme, misalnya untuk melatih kontak mata dan mengenali ekspresi wajah.'),
170: dict(q='Dampak paparan lampu LED biru 6000 K terhadap tidur adalah…',
  e='Cahaya biru dengan suhu warna tinggi seperti 6000 K paling kuat menekan sekresi melatonin oleh kelenjar pineal, jadi paparan di malam hari mengganggu tidur.'),
173: dict(q='Salah satu contoh trace mineral adalah…', o=['Besi', 'Magnesium', 'Sulfur', 'Kalsium', 'Fosfor'],
  e='Trace mineral (mineral mikro) dibutuhkan kurang dari 100 mg per hari, contohnya besi, seng, iodium, dan selenium. Magnesium, sulfur, kalsium, dan fosfor termasuk mineral makro.'),
175: dict(q='Gangguan biolistrik pada jantung dapat diketahui menggunakan alat…', o=['MRI', 'CT scan', 'USG', 'EEG', 'EKG']),
176: dict(q='Senyawa berbau sedap, sukar larut dalam air, dan berisomer fungsi dengan alkohol adalah…', o=['Eter', 'Aldehida', 'Ester', 'Amida'], a=[0],
  e='Eter (R-O-R\') berisomer fungsi dengan alkohol karena rumus umumnya sama, CnH2n+2O. Ester berisomer fungsi dengan asam karboksilat, bukan dengan alkohol.',
  note='Kunci di file asli ester, dikoreksi karena ester berisomer dengan asam karboksilat. Di file asli, pilihan "ETER" juga satu-satunya yang ditulis kapital.'),
177: dict(q='Sifat dari fosfolipid adalah…', o=['Hidrofobik', 'Hidrofilik', 'Amfipatik', 'Larut dalam air', 'Struktur steroid']),
178: dict(o=['Otot jantung', 'Otot soleus', 'Otot biceps', 'Otot deltoid', 'Otot lidah'], e='Soleus hampir terus berkontraksi saat kita berdiri supaya tubuh tidak condong ke depan. Seratnya didominasi serat tipe I yang tahan lelah, jadi cocok untuk kerja postural yang lama.'),
179: dict(q='Serbuk teh dididihkan dengan air, lalu dipindahkan ke corong pisah dan ditambahkan kloroform. Setelah dikocok dan didiamkan terbentuk 2 lapisan, dan sebagian besar kafein berpindah ke lapisan kloroform. Hal ini disebabkan…',
  o=['Kafein lebih mudah larut dalam pelarut organik', 'Kafein lebih larut dalam air karena nonpolar', 'Kafein bersifat hidrofilik', 'Kloroform bersifat sangat polar'],
  e='Kafein lebih mudah larut dalam kloroform daripada dalam air, jadi koefisien distribusinya mendorong kafein pindah ke lapisan kloroform.'),
180: dict(q='Perbandingan [HCO3⁻] : [H2CO3] = 10 : 1 dan pKa H2CO3 = 6,1. Dengan pH = pKa + log([HCO3⁻]/[H2CO3]), berapakah pH-nya?',
  e='pH = 6,1 + log(10/1) = 6,1 + 1 = 7,1. Sebagai pembanding, darah normal punya rasio 20 : 1 sehingga pH-nya sekitar 7,4.',
  note='Rumus di file asli tertulis terbalik ([H2CO3]/[HCO3⁻]). Rumusnya dibetulkan, kuncinya tetap.'),
181: dict(q='Seorang petani menggunakan insektisida untuk membasmi hama di sawahnya. Setelah beberapa tahun, tanahnya masih mengandung residu pestisida yang tinggi walaupun ia sudah berhenti memakainya. Insektisida yang paling mungkin digunakan adalah…'),
183: dict(q='Seorang anak yang tinggal di pusat kota padat lalu lintas mengalami eksaserbasi serangan asma pada siang hari saat terik matahari. Dokter menjelaskan bahwa kondisi ini dipicu oleh pencemar udara sekunder hasil photochemical smog. Polutan fase gas yang paling mungkin menjadi pencetus kondisi pasien tersebut adalah…', o=['Ozon troposferik (O3)', 'Partikulat halus (PM1)', 'Timbal di udara (Pb)', 'Karbon monoksida (CO)', 'Sulfur dioksida (SO2)']),
184: dict(q='Seorang wanita yang tinggal di daerah aliran sungai dekat pembuangan limbah tambang mengalami fraktur patologis, nyeri tulang hebat, dan disfungsi tubulus renalis proksimal. Logam berat pencemar yang paling mungkin menyebabkan kondisi tersebut adalah…'),
187: dict(q='Seorang pasien hipotermia dihangatkan dengan selimut elektrik. Panas berpindah dari selimut (suhu tinggi) ke tubuh pasien (suhu rendah). Mekanisme ini sesuai dengan…',
  o=['Hukum ke-0 Termodinamika', 'Hukum II Termodinamika', 'Homeostasis', 'Energi bebas Gibbs', 'Hukum I Termodinamika'],
  e='Panas mengalir sendiri dari benda bersuhu tinggi ke benda bersuhu rendah, tidak pernah sebaliknya tanpa kerja dari luar. Itu rumusan Clausius untuk Hukum II Termodinamika.',
  note='Pembahasan di file asli menyebut Hukum I, bertentangan dengan kuncinya sendiri (Hukum II). Kuncinya benar, pembahasannya diperbaiki.'),
188: dict(o=['Hukum II Termodinamika', 'Hukum I Termodinamika', 'Hukum ke-0 Termodinamika', 'Homeostasis', 'Entropi berkurang']),
190: dict(q='Penduduk sebuah desa pesisir mengeluhkan gejala neurologis berupa tremor, ataksia, dan penyempitan lapang pandang. Pemeriksaan lanjutan menemukan tingginya kelainan kongenital pada bayi dari ibu yang rutin makan ikan dari teluk setempat. Agen toksik utama penyebab manifestasi klinis tersebut adalah…',
  o=['Metilmerkuri', 'Kadmium', 'Timbal', 'Arsenik', 'Kromium heksavalen']),
191: dict(q='Akson adalah…', o=['Penghantar sinyal kimia yang disebut potensial bergradasi', 'Berkas saraf', 'Tempat terjadinya potensial reseptor bergradasi pada neuron sensorik', 'Struktur panjang dan tipis yang menjulur dari badan sel neuron']),
192: dict(q='Dalam praktikum elektrofisiologi, manakah yang lebih mudah dilakukan?',
  o=['Perekaman potensial aksi secara ekstraseluler', 'Perekaman potensial aksi secara intraseluler', 'Keduanya sama-sama sulit', 'Keduanya sama mudah']),
193: dict(q='Potensial aksi biasanya dimulai pada akson di atau dekat…', o=['Bukit akson (axon hillock)', 'Segmen awal', 'Zona pemicu', 'Semua jawaban di atas']),
194: dict(q='Pemicuan potensial aksi pada neuron sensorik di dalam tubuh biasanya…',
  o=['Terjadi setelah adanya potensial reseptor depolarisasi yang cukup besar', 'Terjadi ketika potensial membran di bukit akson mencapai -70 mV', 'Memerlukan ruang saraf', 'Terjadi pada dendrit']),
195: dict(q='Pada percobaan dengan dua elektroda perekam di sepanjang akson, mengapa potensial aksi yang direkam elektroda kedua (R2) muncul lebih lambat daripada yang direkam elektroda pertama (R1)?',
  o=['Kekuatan stimulus terlalu kecil untuk menghasilkan perekaman simultan', 'Akson dalam eksperimen ini panjangnya tidak wajar', 'Potensial aksi harus merambat dari R1 ke R2', 'Kabel perekam tidak mampu mendeteksi perekaman simultan']),
196: dict(q='Peningkatan kadar K⁺ ekstraseluler menyebabkan depolarisasi neuron, misalnya saat ada neuron yang rusak. Apa dampaknya terhadap akson di sekitarnya? Membran akson di sekitarnya akan…',
  o=['Menghasilkan potensial aksi yang lebih kecil daripada biasanya', 'Mengalami depolarisasi hingga mendekati atau melampaui tegangan ambang', 'Menghasilkan potensial aksi yang lebih cepat daripada biasanya', 'Mengalami hiperpolarisasi menjauhi tegangan ambang']),
197: dict(q='Tegangan ambang pada akson biasanya…',
  o=['Kurang negatif dibandingkan potensial membran istirahat', 'Lebih negatif dibandingkan potensial membran istirahat', 'Dicapai di laboratorium dengan memberikan -20 mV', 'Bernilai sama dengan potensial membran istirahat']),
198: dict(q='Jika potensial reseptor bergradasi membuat potensial membran istirahat akson lebih negatif (misalnya dari -70 mV menjadi -75 mV), maka dapat diperkirakan bahwa…',
  o=['Akson lebih mudah mencapai tegangan ambang', 'Durasi potensial aksi berikutnya menjadi lebih singkat', 'Tidak ada perubahan pada kemampuan akson mencapai tegangan ambang', 'Akson lebih sulit mencapai tegangan ambang']),
199: dict(q='Kegagalan mencapai tegangan ambang pada akson neuron sensorik dapat disebabkan oleh…',
  o=['Potensial reseptor yang membuat potensial membran istirahat akson lebih negatif', 'Potensial reseptor depolarisasi yang tidak memadai', 'Pemberian modalitas stimulus yang keliru', 'Semua jawaban di atas']),
}
