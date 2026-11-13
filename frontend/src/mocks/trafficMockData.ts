import {
  IntersectionSummary,
  IntersectionAnalyticsDetail,
  TimeSeriesPoint,
  CongestionLevel,
} from '../types/traffic';

export function computeCongestionLevel(vehicleCount: number): CongestionLevel {
  if (vehicleCount >= 75) return 'congestionado';
  if (vehicleCount >= 40) return 'moderado';
  return 'fluido';
}

export function formatRealTimeLabel(date: Date = new Date(), includeSeconds = false): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (includeSeconds) {
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${hh}:${mm}`;
}

export const INITIAL_INTERSECTIONS_MOCK: IntersectionSummary[] = [
  {
    id: 'int-001',
    name: 'Av. 18 de Julio y Ejido',
    zone: 'Centro / Cordón',
    cameraCode: 'CAM-MVD-101',
    vehicleCount: 98,
    maxCapacity: 110,
    status: 'congestionado',
    lastUpdated: `${formatRealTimeLabel()} hs`,
    workerNodeId: 'cv-worker-01',
    averageSpeedKmh: 12,
    coordinates: [-34.905683, -56.186853],
    streetCorridors: [
      {
        name: 'Av. 18 de Julio',
        coordinates: [
          [-34.905884, -56.186826],
          [-34.905782, -56.186781],
          [-34.905752, -56.18676],
          [-34.90572, -56.186729],
          [-34.905691, -56.186688],
          [-34.905674, -56.18666],
          [-34.905666, -56.186586],
          [-34.905663, -56.186519],
          [-34.905652, -56.186315],
          [-34.905632, -56.185957],
          [-34.905607, -56.185582],
        ],
      },
      {
        name: 'Av. 18 de Julio',
        coordinates: [
          [-34.905785, -56.189701],
          [-34.905744, -56.189116],
          [-34.905766, -56.189005],
          [-34.905695, -56.187983],
          [-34.905611, -56.186863],
          [-34.90559, -56.186476],
          [-34.90556, -56.185967],
          [-34.905529, -56.185391],
          [-34.905516, -56.185262],
          [-34.905493, -56.185184],
          [-34.90545, -56.185083],
          [-34.905078, -56.184099],
        ],
      },
      {
        name: 'Av. 18 de Julio',
        coordinates: [
          [-34.90501, -56.184122],
          [-34.905384, -56.185115],
          [-34.90542, -56.185203],
          [-34.905446, -56.18527],
          [-34.905461, -56.18535],
          [-34.905496, -56.185975],
          [-34.905554, -56.186871],
          [-34.905607, -56.187567],
          [-34.905636, -56.187988],
          [-34.905707, -56.189008],
          [-34.905744, -56.189116],
        ],
      },
      {
        name: 'Ejido',
        coordinates: [
          [-34.908012, -56.186596],
          [-34.907459, -56.186655],
          [-34.906546, -56.186755],
          [-34.905884, -56.186826],
          [-34.905611, -56.186863],
          [-34.905583, -56.186867],
          [-34.905554, -56.186871],
          [-34.904615, -56.186981],
          [-34.903685, -56.18707],
          [-34.903354, -56.187102],
        ],
      },
    ],
  },
  {
    id: 'int-002',
    name: 'Bvar. Artigas y Av. Italia',
    zone: 'Tres Cruces',
    cameraCode: 'CAM-MVD-102',
    vehicleCount: 112,
    maxCapacity: 120,
    status: 'congestionado',
    lastUpdated: `${formatRealTimeLabel()} hs`,
    workerNodeId: 'cv-worker-03',
    averageSpeedKmh: 9,
    coordinates: [-34.894857, -56.16497],
    streetCorridors: [
      {
        name: 'Bvar. Gral. Artigas',
        coordinates: [
          [-34.897539, -56.164615],
          [-34.897471, -56.164624],
          [-34.897351, -56.164639],
          [-34.897269, -56.164642],
          [-34.897233, -56.164644],
          [-34.897046, -56.164642],
          [-34.896825, -56.164641],
          [-34.896335, -56.164696],
          [-34.896277, -56.164701],
          [-34.895459, -56.164793],
          [-34.895154, -56.164838],
          [-34.895027, -56.164854],
          [-34.894894, -56.164868],
          [-34.894726, -56.164886],
          [-34.894631, -56.164896],
          [-34.894528, -56.16491],
          [-34.89425, -56.164948],
          [-34.894181, -56.164956],
          [-34.893978, -56.164979],
          [-34.89369, -56.165012],
          [-34.893331, -56.165051],
          [-34.893049, -56.165082],
          [-34.892887, -56.165103],
          [-34.892773, -56.165118],
          [-34.892165, -56.165186],
        ],
      },
      {
        name: 'Bvar. Gral. Artigas',
        coordinates: [
          [-34.892177, -56.165347],
          [-34.892666, -56.165295],
          [-34.892788, -56.165285],
          [-34.893399, -56.165217],
          [-34.893623, -56.165191],
          [-34.8937, -56.165183],
          [-34.894092, -56.165143],
          [-34.894198, -56.165132],
          [-34.894276, -56.165124],
          [-34.894545, -56.165093],
          [-34.894575, -56.165091],
          [-34.894645, -56.165085],
          [-34.894943, -56.165062],
          [-34.894999, -56.165059],
          [-34.895125, -56.165045],
          [-34.895223, -56.165035],
          [-34.89536, -56.16502],
          [-34.895485, -56.165002],
          [-34.895717, -56.164976],
          [-34.896215, -56.16492],
          [-34.896301, -56.16491],
          [-34.896353, -56.164902],
          [-34.896445, -56.16489],
          [-34.897365, -56.164788],
          [-34.897395, -56.164784],
          [-34.897501, -56.164769],
          [-34.89755, -56.164763],
        ],
      },
      {
        name: 'Av. Italia',
        coordinates: [
          [-34.89361, -56.162053],
          [-34.893887, -56.162586],
          [-34.893938, -56.162699],
          [-34.893978, -56.162796],
          [-34.89426, -56.163514],
          [-34.894373, -56.163805],
          [-34.894406, -56.163891],
          [-34.894561, -56.164288],
          [-34.894589, -56.164387],
          [-34.894605, -56.164515],
          [-34.894623, -56.164776],
          [-34.894631, -56.164896],
          [-34.894645, -56.165085],
        ],
      },
      {
        name: 'Av. Italia',
        coordinates: [
          [-34.895125, -56.165045],
          [-34.895027, -56.164854],
          [-34.894981, -56.164758],
          [-34.894892, -56.16458],
          [-34.894568, -56.16392],
          [-34.89447, -56.163712],
          [-34.894369, -56.163485],
          [-34.894217, -56.16309],
          [-34.894053, -56.162665],
          [-34.894011, -56.162548],
          [-34.893767, -56.161961],
        ],
      },
    ],
  },
  {
    id: 'int-003',
    name: 'Av. Gral. Rivera y L. A. de Herrera',
    zone: 'Pocitos / Buceo',
    cameraCode: 'CAM-MVD-103',
    vehicleCount: 86,
    maxCapacity: 95,
    status: 'congestionado',
    lastUpdated: `${formatRealTimeLabel()} hs`,
    workerNodeId: 'cv-worker-02',
    averageSpeedKmh: 15,
    coordinates: [-34.901218, -56.138478],
    streetCorridors: [
      {
        name: 'Av. Gral. Rivera',
        coordinates: [
          [-34.902007, -56.141394],
          [-34.901914, -56.14102],
          [-34.901822, -56.140594],
          [-34.901646, -56.139894],
          [-34.901237, -56.138542],
          [-34.901217, -56.138475],
          [-34.901199, -56.138413],
          [-34.900983, -56.137754],
          [-34.900755, -56.137081],
          [-34.900672, -56.13685],
          [-34.900235, -56.13566],
        ],
      },
      {
        name: 'Av. L. A. de Herrera',
        coordinates: [
          [-34.899097, -56.140134],
          [-34.899098, -56.140133],
          [-34.899974, -56.139378],
          [-34.900486, -56.138928],
          [-34.900627, -56.138836],
          [-34.900719, -56.138766],
          [-34.900822, -56.138711],
          [-34.900891, -56.138673],
          [-34.901052, -56.138608],
          [-34.901136, -56.138579],
          [-34.901237, -56.138542],
          [-34.901581, -56.138409],
          [-34.901735, -56.138354],
          [-34.901812, -56.138274],
          [-34.902206, -56.138121],
          [-34.902223, -56.138102],
          [-34.902232, -56.138073],
          [-34.902226, -56.138033],
        ],
      },
      {
        name: 'Av. L. A. de Herrera',
        coordinates: [
          [-34.903616, -56.13754],
          [-34.902583, -56.137916],
          [-34.902226, -56.138033],
          [-34.901546, -56.138277],
          [-34.901411, -56.138323],
          [-34.901199, -56.138413],
          [-34.901119, -56.138442],
          [-34.901034, -56.138469],
          [-34.900887, -56.138519],
          [-34.900781, -56.138569],
          [-34.900594, -56.138682],
          [-34.900445, -56.138796],
          [-34.899907, -56.139271],
          [-34.899682, -56.139473],
          [-34.899156, -56.13992],
          [-34.899069, -56.139988],
          [-34.899037, -56.140013],
        ],
      },
      {
        name: 'Av. L. A. de Herrera',
        coordinates: [
          [-34.901735, -56.138354],
          [-34.902437, -56.1381],
          [-34.902647, -56.138031],
          [-34.903521, -56.137733],
          [-34.903651, -56.137687],
        ],
      },
    ],
  },
  {
    id: 'int-004',
    name: 'Rambla República del Perú y Pagola',
    zone: 'Pocitos',
    cameraCode: 'CAM-MVD-104',
    vehicleCount: 54,
    maxCapacity: 100,
    status: 'moderado',
    lastUpdated: `${formatRealTimeLabel()} hs`,
    workerNodeId: 'cv-worker-01',
    averageSpeedKmh: 38,
    coordinates: [-34.910301, -56.144093],
    streetCorridors: [
      {
        name: 'Rambla República del Perú',
        coordinates: [
          [-34.909564, -56.141157],
          [-34.909514, -56.141492],
          [-34.909421, -56.142125],
          [-34.909402, -56.142304],
          [-34.9094, -56.142366],
          [-34.909402, -56.142456],
          [-34.909411, -56.142539],
          [-34.909424, -56.142607],
          [-34.909456, -56.142742],
          [-34.909512, -56.142963],
          [-34.90954, -56.143047],
          [-34.909572, -56.143133],
          [-34.90965, -56.143278],
          [-34.909718, -56.143381],
          [-34.909761, -56.143438],
          [-34.910132, -56.143884],
          [-34.910211, -56.143985],
          [-34.910264, -56.144048],
          [-34.910301, -56.144093],
          [-34.910591, -56.144435],
          [-34.910849, -56.144721],
          [-34.910931, -56.144815],
          [-34.911002, -56.144897],
          [-34.911603, -56.145604],
          [-34.911641, -56.145648],
          [-34.911893, -56.145924],
          [-34.912101, -56.146165],
          [-34.912134, -56.146199],
        ],
      },
      {
        name: 'Rambla República del Perú',
        coordinates: [
          [-34.9122, -56.146109],
          [-34.912158, -56.14606],
          [-34.911694, -56.145521],
          [-34.91109, -56.144818],
          [-34.910726, -56.144415],
          [-34.910282, -56.143894],
          [-34.909903, -56.143461],
          [-34.909758, -56.143277],
          [-34.909717, -56.143212],
          [-34.909689, -56.143151],
          [-34.90963, -56.143029],
          [-34.909575, -56.142866],
          [-34.909546, -56.142737],
          [-34.909519, -56.142583],
          [-34.909503, -56.142474],
          [-34.9095, -56.142357],
          [-34.909499, -56.142303],
          [-34.909511, -56.142132],
          [-34.90964, -56.14124],
          [-34.909663, -56.141123],
        ],
      },
      {
        name: 'Manuel Pagola',
        coordinates: [
          [-34.910301, -56.144093],
          [-34.910155, -56.14425],
          [-34.910097, -56.144306],
          [-34.909351, -56.145023],
          [-34.90863, -56.145716],
          [-34.908333, -56.146008],
        ],
      },
    ],
  },
  {
    id: 'int-005',
    name: 'Av. Agraciada y Palacio Legislativo',
    zone: 'Aguada',
    cameraCode: 'CAM-MVD-105',
    vehicleCount: 62,
    maxCapacity: 100,
    status: 'moderado',
    lastUpdated: `${formatRealTimeLabel()} hs`,
    workerNodeId: 'cv-worker-04',
    averageSpeedKmh: 31,
    coordinates: [-34.889879, -56.187424],
    streetCorridors: [
      {
        name: 'Av. Agraciada',
        coordinates: [
          [-34.890164, -56.187151],
          [-34.890062, -56.187247],
          [-34.889928, -56.187365],
          [-34.889634, -56.18762],
          [-34.889627, -56.187626],
          [-34.889593, -56.187698],
          [-34.889519, -56.187763],
          [-34.889501, -56.187779],
          [-34.889142, -56.188091],
          [-34.888904, -56.1883],
          [-34.888688, -56.188507],
          [-34.888488, -56.188686],
          [-34.8884, -56.188759],
          [-34.888266, -56.188882],
          [-34.888173, -56.188912],
          [-34.888025, -56.189034],
          [-34.887962, -56.189101],
          [-34.887899, -56.18918],
          [-34.887855, -56.189251],
        ],
      },
      {
        name: 'Av. de las Leyes (Palacio Legislativo)',
        coordinates: [
          [-34.891793, -56.186252],
          [-34.891367, -56.186048],
          [-34.89091, -56.185817],
          [-34.890828, -56.1858],
          [-34.890754, -56.185803],
          [-34.890685, -56.185816],
          [-34.890616, -56.185864],
          [-34.890585, -56.185906],
          [-34.890565, -56.185953],
          [-34.890524, -56.186075],
          [-34.890379, -56.186503],
          [-34.890301, -56.18674],
          [-34.890164, -56.187151],
          [-34.890115, -56.187362],
          [-34.890094, -56.187488],
          [-34.890082, -56.187675],
          [-34.890082, -56.187782],
          [-34.89019, -56.187876],
          [-34.890399, -56.187983],
          [-34.890836, -56.188197],
          [-34.891511, -56.188531],
          [-34.891615, -56.188581],
          [-34.891682, -56.188611],
          [-34.891747, -56.188616],
          [-34.891794, -56.188617],
          [-34.891852, -56.188607],
          [-34.891899, -56.188587],
          [-34.89194, -56.18856],
          [-34.891993, -56.188505],
          [-34.892053, -56.188426],
          [-34.892103, -56.188289],
          [-34.89218, -56.188074],
          [-34.892204, -56.188],
          [-34.892289, -56.187745],
          [-34.892314, -56.187669],
          [-34.892356, -56.187541],
          [-34.892397, -56.187424],
        ],
      },
      {
        name: 'Av. de las Leyes (Palacio Legislativo)',
        coordinates: [
          [-34.891906, -56.186467],
          [-34.891749, -56.18639],
          [-34.891312, -56.186175],
          [-34.891167, -56.186102],
          [-34.89102, -56.186034],
          [-34.890957, -56.186021],
          [-34.890902, -56.18602],
          [-34.890851, -56.18603],
          [-34.89081, -56.186049],
          [-34.890744, -56.186086],
          [-34.890679, -56.186141],
          [-34.890629, -56.186202],
          [-34.890565, -56.186316],
          [-34.890464, -56.18662],
          [-34.890403, -56.186793],
          [-34.890256, -56.187308],
          [-34.890238, -56.187405],
          [-34.890254, -56.187514],
          [-34.890273, -56.187583],
          [-34.890315, -56.187676],
          [-34.890379, -56.187769],
          [-34.890484, -56.187863],
          [-34.890548, -56.187893],
          [-34.890885, -56.188054],
          [-34.891276, -56.188249],
          [-34.891622, -56.188417],
          [-34.891665, -56.188433],
          [-34.891715, -56.188442],
          [-34.891759, -56.188438],
          [-34.891828, -56.188418],
          [-34.891889, -56.188381],
          [-34.891907, -56.188367],
          [-34.89195, -56.18831],
          [-34.892063, -56.187981],
          [-34.892164, -56.187687],
          [-34.89229, -56.187322],
          [-34.892376, -56.187072],
          [-34.892378, -56.18705],
        ],
      },
      {
        name: 'Av. de las Leyes (Palacio Legislativo)',
        coordinates: [
          [-34.89091, -56.185817],
          [-34.890528, -56.1856],
          [-34.889852, -56.185256],
        ],
      },
      {
        name: 'Av. de las Leyes (Palacio Legislativo)',
        coordinates: [
          [-34.889593, -56.187698],
          [-34.889677, -56.187692],
          [-34.889747, -56.187696],
          [-34.889814, -56.187698],
          [-34.88988, -56.187705],
          [-34.890082, -56.187782],
          [-34.890115, -56.187778],
          [-34.890207, -56.187765],
          [-34.890427, -56.187872],
          [-34.890484, -56.187863],
        ],
      },
    ],
  },
  {
    id: 'int-006',
    name: 'Av. Sarmiento y Bvar. Artigas',
    zone: 'Parque Rodó',
    cameraCode: 'CAM-MVD-106',
    vehicleCount: 24,
    maxCapacity: 80,
    status: 'fluido',
    lastUpdated: `${formatRealTimeLabel()} hs`,
    workerNodeId: 'cv-worker-02',
    averageSpeedKmh: 48,
    coordinates: [-34.914753, -56.162771],
    streetCorridors: [
      {
        name: 'Av. Sarmiento',
        coordinates: [
          [-34.914767, -56.162448],
          [-34.914758, -56.162326],
          [-34.914736, -56.162069],
          [-34.914693, -56.161957],
          [-34.914674, -56.162062],
          [-34.914691, -56.162336],
          [-34.914698, -56.162455],
          [-34.914738, -56.163068],
          [-34.914752, -56.163215],
          [-34.914787, -56.163595],
          [-34.914818, -56.163659],
          [-34.914837, -56.163596],
          [-34.914816, -56.163207],
          [-34.914808, -56.163061],
          [-34.914767, -56.162448],
        ],
      },
      {
        name: 'Av. Sarmiento',
        coordinates: [
          [-34.914693, -56.161957],
          [-34.914648, -56.161373],
          [-34.914581, -56.160413],
          [-34.914557, -56.160099],
          [-34.914536, -56.159863],
          [-34.914525, -56.159713],
        ],
      },
      {
        name: 'Av. Sarmiento',
        coordinates: [
          [-34.914986, -56.165776],
          [-34.914933, -56.16512],
          [-34.914845, -56.16401],
          [-34.914818, -56.163659],
        ],
      },
      {
        name: 'Bvar. Gral. Artigas',
        coordinates: [
          [-34.912254, -56.16315],
          [-34.912326, -56.163142],
          [-34.912371, -56.163137],
          [-34.91239, -56.163135],
          [-34.912673, -56.163106],
          [-34.912802, -56.163094],
          [-34.912906, -56.163081],
          [-34.91302, -56.16307],
          [-34.913476, -56.163014],
          [-34.913553, -56.163008],
          [-34.913601, -56.163004],
          [-34.913919, -56.162972],
          [-34.913966, -56.162967],
          [-34.914675, -56.162885],
          [-34.914844, -56.162867],
          [-34.915379, -56.162808],
          [-34.9163, -56.162716],
          [-34.916498, -56.162695],
          [-34.916647, -56.16268],
          [-34.917268, -56.162617],
        ],
      },
      {
        name: 'Bvar. Gral. Artigas',
        coordinates: [
          [-34.917252, -56.162392],
          [-34.9172, -56.162397],
          [-34.916725, -56.162453],
          [-34.916632, -56.162463],
          [-34.916285, -56.162505],
          [-34.914832, -56.162659],
          [-34.914663, -56.162678],
          [-34.913893, -56.162767],
          [-34.913838, -56.162774],
          [-34.913573, -56.162802],
          [-34.913466, -56.162813],
          [-34.913148, -56.162843],
          [-34.913047, -56.162852],
          [-34.912946, -56.162861],
          [-34.912374, -56.162929],
          [-34.912239, -56.162944],
        ],
      },
    ],
  },
  {
    id: 'int-007',
    name: 'Av. 8 de Octubre y Propios',
    zone: 'La Blanqueada',
    cameraCode: 'CAM-MVD-107',
    vehicleCount: 91,
    maxCapacity: 100,
    status: 'congestionado',
    lastUpdated: `${formatRealTimeLabel()} hs`,
    workerNodeId: 'cv-worker-04',
    averageSpeedKmh: 14,
    coordinates: [-34.879274, -56.14792],
    streetCorridors: [
      {
        name: 'Av. 8 de Octubre',
        coordinates: [
          [-34.88076, -56.150398],
          [-34.880451, -56.149883],
          [-34.880401, -56.149798],
          [-34.879487, -56.148277],
          [-34.879313, -56.147991],
          [-34.879274, -56.147921],
          [-34.879234, -56.147848],
          [-34.878751, -56.147021],
          [-34.878625, -56.146797],
          [-34.87813, -56.145904],
          [-34.877842, -56.145395],
        ],
      },
      {
        name: 'Bvar. José Batlle y Ordóñez (Propios)',
        coordinates: [
          [-34.880911, -56.145587],
          [-34.880609, -56.145988],
          [-34.880566, -56.146048],
          [-34.879883, -56.146977],
          [-34.879424, -56.1476],
          [-34.879234, -56.147848],
          [-34.878985, -56.148187],
          [-34.87859, -56.14871],
          [-34.878089, -56.149369],
          [-34.877939, -56.149567],
          [-34.877518, -56.15012],
        ],
      },
      {
        name: 'Bvar. José Batlle y Ordóñez (Propios)',
        coordinates: [
          [-34.877612, -56.150226],
          [-34.877849, -56.149907],
          [-34.878004, -56.149698],
          [-34.878165, -56.149487],
          [-34.878692, -56.148801],
          [-34.879025, -56.148376],
          [-34.879088, -56.148292],
          [-34.879313, -56.147991],
          [-34.879967, -56.147111],
          [-34.880219, -56.146771],
          [-34.880255, -56.146721],
          [-34.880678, -56.146139],
          [-34.880703, -56.146105],
          [-34.880828, -56.145931],
          [-34.881003, -56.145688],
        ],
      },
    ],
  },
  {
    id: 'int-008',
    name: 'Av. Millán y Cisplatina',
    zone: 'Prado',
    cameraCode: 'CAM-MVD-108',
    vehicleCount: 19,
    maxCapacity: 85,
    status: 'fluido',
    lastUpdated: `${formatRealTimeLabel()} hs`,
    workerNodeId: 'cv-worker-03',
    averageSpeedKmh: 52,
    coordinates: [-34.866446, -56.192337],
    streetCorridors: [
      {
        name: 'Av. Millán',
        coordinates: [
          [-34.868821, -56.191723],
          [-34.868792, -56.19173],
          [-34.868441, -56.191823],
          [-34.868253, -56.191873],
          [-34.867391, -56.192103],
          [-34.866804, -56.192249],
          [-34.866446, -56.192337],
          [-34.866074, -56.192432],
          [-34.865597, -56.192554],
          [-34.864326, -56.192878],
          [-34.86407, -56.192945],
        ],
      },
      {
        name: 'Cisplatina',
        coordinates: [
          [-34.866446, -56.192337],
          [-34.866383, -56.194302],
          [-34.866361, -56.195295],
        ],
      },
    ],
  },
];

export const CONCURRENT_CONGESTION_PRESET: IntersectionSummary[] = INITIAL_INTERSECTIONS_MOCK.map(
  (item, idx) => {
    // 6 of 8 intersections in critical congestion simultaneously to showcase parallel RabbitMQ worker scaling
    const isCongested = idx < 6;
    const count = isCongested ? 88 + idx * 6 : 34 + idx * 3;
    return {
      ...item,
      vehicleCount: count,
      status: computeCongestionLevel(count),
      lastUpdated: `${formatRealTimeLabel(new Date(), true)} hs (Paralelo < 1s)`,
      averageSpeedKmh: isCongested ? 11 : 44,
    };
  }
);

const HISTORICAL_SERIES_BY_ID: Record<string, number[]> = {
  'int-001': [18, 22, 35, 68, 84, 72, 58, 64, 78, 92, 96, 98],
  'int-002': [25, 30, 48, 88, 95, 76, 65, 70, 85, 104, 109, 112],
  'int-003': [14, 19, 31, 52, 61, 49, 44, 58, 79, 88, 84, 86],
  'int-004': [12, 16, 28, 55, 62, 48, 42, 45, 51, 58, 56, 54],
  'int-005': [15, 20, 38, 64, 70, 55, 49, 52, 60, 66, 64, 62],
  'int-006': [8, 10, 19, 32, 36, 28, 22, 25, 29, 27, 25, 24],
  'int-007': [20, 26, 42, 74, 81, 66, 62, 75, 86, 94, 89, 91],
  'int-008': [7, 9, 15, 28, 31, 24, 19, 21, 23, 22, 20, 19],
};

/**
 * Generates the initial 12-point historical series ending at the current real clock time,
 * with previous points spaced backwards hour by hour so the history matches the user's real clock.
 */
export function createInitialTimeSeriesMap(): Record<string, TimeSeriesPoint[]> {
  const now = new Date();
  const currentMinutes = String(now.getMinutes()).padStart(2, '0');
  const map: Record<string, TimeSeriesPoint[]> = {};

  for (const intersection of INITIAL_INTERSECTIONS_MOCK) {
    const counts = HISTORICAL_SERIES_BY_ID[intersection.id] || [
      20, 28, 45, 60, 55, 48, 52, 60, 70, 78, 82, intersection.vehicleCount,
    ];
    const totalPoints = counts.length;

    map[intersection.id] = counts.map((vehicles, idx) => {
      const hoursAgo = totalPoints - 1 - idx;
      const pointDate = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
      const hh = String(pointDate.getHours()).padStart(2, '0');
      const label = hoursAgo === 0 ? `${hh}:${currentMinutes}` : `${hh}:00`;

      return {
        hour: label,
        timestamp: pointDate.toISOString(),
        vehicles,
        thresholdCongestion: 75,
        thresholdModerate: 40,
      };
    });
  }

  return map;
}

export function buildMockAnalyticsDetail(
  intersection: IntersectionSummary,
  customTimeSeries?: TimeSeriesPoint[]
): IntersectionAnalyticsDetail {
  const timeSeries: TimeSeriesPoint[] =
    customTimeSeries && customTimeSeries.length > 0
      ? customTimeSeries
      : createInitialTimeSeriesMap()[intersection.id];

  const seriesCounts = timeSeries.map((pt) => pt.vehicles);

  // Calculate congestion duration and pattern classification
  const congestedHoursCount = seriesCounts.slice(-4).filter((v) => v >= 75).length;
  const congestionDurationMinutes =
    intersection.status === 'congestionado'
      ? Math.max(18, congestedHoursCount * 22 + (intersection.vehicleCount - 75))
      : intersection.status === 'moderado'
      ? 8
      : 0;

  // Distinguish between habitual peak hour vs anomalous spike
  const isAnomalous =
    intersection.id === 'int-003' ||
    intersection.id === 'int-007' ||
    intersection.vehicleCount > 105;

  const patternType = isAnomalous ? 'anomalo' : 'habitual';
  const patternLabel = isAnomalous
    ? 'Patrón Anómalo (Incidente / Retención Atípica)'
    : 'Patrón Habitual (Hora Pico Vespertina)';

  const patternDescription = isAnomalous
    ? 'El volumen vehicular supera en +34% la media histórica para esta franja horaria. Posible obstrucción de calzada o desvío canalizado.'
    : 'El flujo responde a la curva estacional esperada registrada en la serie histórica de PostgreSQL.';

  let peakVehicles = 0;
  let peakHour = timeSeries[timeSeries.length - 1]?.hour || '18:00';
  timeSeries.forEach((pt) => {
    if (pt.vehicles > peakVehicles) {
      peakVehicles = pt.vehicles;
      peakHour = pt.hour;
    }
  });

  const last6 = seriesCounts.slice(-6);
  const avgVehiclesLast6h = Math.round(
    last6.reduce((acc, curr) => acc + curr, 0) / last6.length
  );

  return {
    intersection,
    timeSeries,
    metrics: {
      congestionDurationMinutes,
      patternType,
      patternLabel,
      patternDescription,
      peakHour,
      peakVehicles,
      avgVehiclesLast6h,
      queueStatus: 'activo',
    },
  };
}
