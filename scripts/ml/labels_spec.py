"""
Etiquetas que el modelo compara con cada foto (CLIP «zero-shot»): los 19 productos del catálogo,
otros productos del campo que no están en el catálogo, cosas que no son productos y fotos que no
dejan ver nada. Cada etiqueta tiene varias frases en inglés (CLIP se entrenó sobre todo en inglés);
su vector es el promedio de los vectores de esas frases.
"""

# plantillas para los productos (fotos de cosecha, sacos, mercado)
T_PROD = [
    'a photo of {}.', 'a pile of {}.', 'a close-up photo of {}.', 'a sack full of {}.',
    'freshly harvested {} on a farm.', '{} for sale at a local market.', 'a crate of {}.', 'a photo of {}, a type of food.',
]
T_OBJ = ['a photo of {}.', 'a close-up photo of {}.', 'a picture of {}.']

# id, nombre en español, grupo, frases (cada una va en las plantillas), plantillas
PRODUCTS = [
    ('papa_amarilla', 'papa amarilla', ['yellow potatoes', 'potatoes', 'yellow-fleshed Andean potatoes']),
    ('papa_blanca', 'papa blanca', ['white potatoes', 'potatoes', 'light-skinned potatoes']),
    ('papa_nativa', 'papa nativa', ['native Andean potatoes', 'colorful purple and red potatoes', 'small native potatoes of many colors']),
    ('cebolla_roja', 'cebolla roja', ['red onions', 'purple onions', 'onions']),
    ('tomate', 'tomate', ['tomatoes', 'red tomatoes', 'ripe tomatoes']),
    ('frejol_canario', 'frejol canario', ['dry yellow beans', 'canary beans', 'dried beans']),
    ('arroz_cascara', 'arroz en cáscara', ['paddy rice', 'unhusked rice grains', 'rice with husk']),
    ('arroz_pilado', 'arroz pilado', ['white rice grains', 'uncooked white rice', 'milled rice']),
    ('maiz_choclo', 'choclo', ['corn on the cob', 'ears of white corn', 'fresh corn cobs in their green husks', 'ears of corn wrapped in green husks']),
    ('haba_verde', 'haba verde', ['green fava bean pods', 'broad bean pods', 'fresh fava beans']),
    ('haba_seca', 'haba seca', ['dried fava beans', 'dry broad beans', 'dried brown fava beans']),
    ('quinua', 'quinua', ['quinoa seeds', 'quinoa grains', 'raw quinoa']),
    ('zanahoria', 'zanahoria', ['carrots', 'orange carrots', 'fresh carrots']),
    ('olluco', 'olluco', ['small round yellow tubers with pink spots', 'glossy yellow and magenta round tubers', 'ulluco tubers']),
    ('oca', 'oca', ['small elongated wrinkled pink tubers', 'knobby pink and yellow oca tubers']),
    ('ajo', 'ajo', ['garlic bulbs', 'garlic', 'heads of garlic']),
    ('rocoto', 'rocoto', ['rocoto peppers', 'red hot peppers', 'round red chili peppers']),
    ('zapallo', 'zapallo', ['squash', 'pumpkins', 'a big squash']),
    ('chuno', 'chuño', ['black freeze-dried potatoes', 'dried black potatoes that look like small dark stones']),
]

# otros productos del campo (no están en el catálogo)
OTHER = [
    ('camote', 'camote', ['sweet potatoes']), ('yuca', 'yuca', ['cassava roots with brown bark-like skin']),
    ('cebolla_blanca', 'cebolla blanca', ['white onions']), ('betarraga', 'betarraga', ['beets', 'beetroots']),
    ('rabanito', 'rabanito', ['radishes']), ('kion', 'kion', ['ginger root']),
    ('pimiento', 'pimiento', ['bell peppers']), ('aji', 'ají', ['yellow chili peppers', 'chili peppers']),
    ('manzana', 'manzana', ['apples']), ('platano', 'plátano', ['bananas']), ('naranja', 'naranja', ['oranges', 'tangerines']),
    ('limon', 'limón', ['lemons', 'limes']), ('palta', 'palta', ['avocados']), ('uva', 'uva', ['grapes']),
    ('fresa', 'fresa', ['strawberries']), ('mango', 'mango', ['mangoes']), ('papaya', 'papaya', ['papayas']),
    ('pina', 'piña', ['pineapples']), ('sandia', 'sandía', ['watermelons', 'melons']), ('durazno', 'durazno', ['peaches', 'plums']),
    ('pera', 'pera', ['pears']), ('tuna', 'tuna', ['prickly pears, cactus fruit']), ('aguaymanto', 'aguaymanto', ['physalis, golden berries']),
    ('lechuga', 'lechuga', ['lettuce', 'leafy greens']), ('col', 'col', ['cabbage']), ('brocoli', 'brócoli', ['broccoli', 'cauliflower']),
    ('pepino', 'pepino', ['cucumbers']), ('zucchini', 'zucchini', ['zucchini']), ('berenjena', 'berenjena', ['eggplants']),
    ('vainita', 'vainita', ['green beans']), ('arveja', 'arveja', ['green peas', 'pea pods']), ('hongos', 'hongos', ['mushrooms']),
    ('apio', 'apio', ['celery stalks', 'leeks']), ('hierbas', 'hierbas', ['fresh herbs, cilantro and parsley']),
    ('mani', 'maní', ['peanuts']), ('nueces', 'nueces', ['nuts', 'walnuts', 'chestnuts']), ('cafe_grano', 'café en grano', ['coffee beans']),
    ('cacao', 'cacao', ['cocoa beans', 'cacao pods']), ('trigo', 'trigo', ['wheat grains', 'barley grains']),
    ('lentejas', 'lentejas', ['lentils']), ('garbanzos', 'garbanzos', ['chickpeas']), ('maiz_seco', 'maíz seco', ['dried corn kernels', 'popcorn kernels']),
    ('kiwicha', 'kiwicha', ['amaranth seeds']), ('aceituna', 'aceituna', ['olives']), ('coco', 'coco', ['coconuts']),
    ('flores', 'flores', ['a bouquet of flowers', 'flowers']), ('huevos', 'huevos', ['eggs']), ('carne', 'carne', ['raw meat', 'fish']),
]

# cosas que no son productos del campo
NOT = [
    ('botella_gaseosa', 'una botella de gaseosa', ['a plastic bottle of soda', 'a bottle of cola'], T_OBJ),
    ('bebida_deportiva', 'una botella de bebida (tipo Gatorade)', ['a bottle of sports drink', 'a bottle of Gatorade', 'an energy drink bottle'], T_OBJ),
    ('botella_agua', 'una botella de agua', ['a plastic bottle of water'], T_OBJ),
    ('cerveza', 'una botella de cerveza o vino', ['a bottle of beer', 'a bottle of wine', 'a beer can'], T_OBJ),
    ('lata', 'una lata de bebida', ['a can of soda', 'an aluminum drink can'], T_OBJ),
    ('jugo', 'una caja o vaso de jugo', ['a carton of juice', 'a glass of juice'], T_OBJ),
    ('cafe_taza', 'una taza de café', ['a cup of coffee'], T_OBJ),
    ('snack', 'un paquete de snacks', ['a bag of potato chips', 'packaged snacks', 'a bag of candy'], T_OBJ),
    ('caja_comida', 'comida empaquetada', ['a box of cereal', 'canned food', 'packaged food on a supermarket shelf'], T_OBJ),
    ('comida', 'un plato de comida', ['a plate of cooked food', 'a bowl of soup', 'a restaurant dish'], T_OBJ),
    ('comida_rapida', 'comida rápida', ['a hamburger', 'a pizza', 'french fries', 'a sandwich'], T_OBJ),
    ('pan', 'pan o pasteles', ['bread', 'a cake', 'pastries'], T_OBJ),
    ('persona', 'una persona', ['a selfie of a person', 'a portrait of a person', 'a person smiling at the camera'], T_OBJ),
    ('grupo', 'un grupo de personas', ['a group of people', 'a crowd of people'], T_OBJ),
    ('bebe', 'un niño o bebé', ['a baby', 'a child'], T_OBJ),
    ('perro', 'un perro o gato', ['a dog', 'a cat', 'a pet'], T_OBJ),
    ('animal_granja', 'un animal de granja', ['a cow', 'a sheep', 'a pig', 'a chicken', 'a horse', 'a llama'], T_OBJ),
    ('animal', 'un animal', ['a wild animal', 'a bird', 'an insect', 'a fish in water', 'a reptile'], T_OBJ),
    ('vehiculo', 'un vehículo', ['a car', 'a truck', 'a motorcycle', 'a bus'], T_OBJ),
    ('casa', 'una casa o edificio', ['a house', 'a building', 'a city street'], T_OBJ),
    ('interior', 'un cuarto o una cocina', ['a room interior', 'a kitchen', 'an office', 'a living room'], T_OBJ),
    ('captura', 'una captura de pantalla', ['a screenshot of a phone screen', 'a screenshot of a website', 'a screenshot of a social media post'], T_OBJ),
    ('pantalla', 'una pantalla de computadora o celular', ['a computer monitor', 'a mobile phone', 'a laptop'], T_OBJ),
    ('documento', 'un documento con texto', ['a document with text', 'a printed page', 'a receipt', 'a handwritten note'], T_OBJ),
    ('tarjeta', 'un documento de identidad o tarjeta', ['an ID card', 'a credit card', 'a business card'], T_OBJ),
    ('meme', 'un meme o imagen con texto', ['a meme with text', 'a poster with text', 'an advertisement'], T_OBJ),
    ('logo', 'un logo o dibujo', ['a logo', 'a cartoon drawing', 'a clip art illustration', 'an emoji'], T_OBJ),
    ('qr', 'un código QR', ['a QR code', 'a barcode'], T_OBJ),
    ('dinero', 'billetes o monedas', ['money bills', 'coins'], T_OBJ),
    ('ropa', 'ropa o zapatos', ['clothes', 'shoes', 'a bag'], T_OBJ),
    ('objeto', 'un objeto de la casa', ['furniture', 'tools', 'a toy', 'kitchen utensils', 'a plastic bucket'], T_OBJ),
    ('planta', 'una planta en maceta', ['a houseplant in a pot', 'a tree'], T_OBJ),
]

# fotos que no dejan ver el producto (no son señal de engaño: hay que mirarlas)
UNCLEAR = [
    ('chacra', 'la chacra o el paisaje, sin el producto de cerca', ['an empty farm field', 'a landscape with mountains', 'a green crop field', 'farmland'], T_OBJ),
    ('agricultor', 'una persona trabajando en el campo', ['a farmer working in a field', 'people harvesting in a field'], T_OBJ),
    ('sacos', 'sacos cerrados (no se ve qué hay dentro)', ['closed sacks', 'stacked bags of grain', 'closed burlap sacks'], T_OBJ),
    ('oscura', 'una foto oscura o borrosa', ['a very dark photo', 'a blurry photo', 'a black image'], T_OBJ),
]

# estilo de la foto: ¿parece tomada por el agricultor o sacada de internet?
STYLE = [
    ('real', ['a real phone photo taken outdoors on a farm', 'an amateur photo of a harvest', 'a casual photo at a local market', 'a photo of produce on the ground']),
    ('catalogo', ['a professional stock photo of produce isolated on a white background', 'a studio product photo with a white background']),
    ('dibujo', ['a digital illustration', 'a 3d render', 'a cartoon', 'a painting']),
    ('texto', ['an image with a watermark', 'an image with large text', 'a screenshot']),
]

# variedades del mismo producto: confundirlas no es un error grave (se acepta con una nota)
VARIETY = [['papa_amarilla', 'papa_blanca', 'papa_nativa'], ['arroz_cascara', 'arroz_pilado']]

# fondo blanco de catálogo frente a foto de la cosecha (solo como nota)
WHITE = (['a product photo isolated on a white background', 'a stock photo of a vegetable on a white background', 'a fruit isolated on white'],
         ['a photo of vegetables in a natural setting', 'a photo of a harvest on a farm', 'a photo of produce at a market stall', 'a photo of food on a table'])

# productos que se confunden a la vista con el declarado: confundirlos es «dudoso», no «no corresponde»
SIMILAR = {
    'papa_amarilla': ['papa_blanca', 'papa_nativa', 'oca', 'olluco', 'camote', 'yuca'],
    'papa_blanca': ['papa_amarilla', 'papa_nativa', 'oca', 'camote', 'yuca'],
    'papa_nativa': ['papa_amarilla', 'papa_blanca', 'oca', 'olluco', 'camote', 'betarraga'],
    'cebolla_roja': ['cebolla_blanca', 'ajo', 'betarraga', 'rabanito'],
    'tomate': ['rocoto', 'pimiento', 'aji'],
    'frejol_canario': ['haba_seca', 'lentejas', 'garbanzos', 'mani', 'maiz_seco'],
    'arroz_cascara': ['arroz_pilado', 'quinua', 'trigo', 'kiwicha'],
    'arroz_pilado': ['arroz_cascara', 'quinua', 'trigo', 'kiwicha'],
    'maiz_choclo': ['maiz_seco'],
    'haba_verde': ['haba_seca', 'arveja', 'vainita'],
    'haba_seca': ['haba_verde', 'frejol_canario', 'garbanzos', 'mani', 'nueces', 'cafe_grano'],
    'quinua': ['arroz_pilado', 'arroz_cascara', 'kiwicha', 'trigo'],
    'zanahoria': ['camote'],
    'olluco': ['oca', 'papa_amarilla', 'papa_nativa', 'papa_blanca'],
    'oca': ['olluco', 'papa_nativa', 'papa_amarilla', 'camote', 'zanahoria'],
    'ajo': ['cebolla_blanca', 'cebolla_roja'],
    'rocoto': ['tomate', 'pimiento', 'aji'],
    'zapallo': ['sandia', 'naranja', 'papaya'],
    'chuno': ['papa_nativa', 'papa_blanca', 'papa_amarilla', 'oca', 'nueces', 'cafe_grano'],
}
