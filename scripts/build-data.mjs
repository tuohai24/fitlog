// 构建动作库数据：英文数据集 -> 中文动作名 + 中文步骤讲解
// 用法: node scripts/build-data.mjs [rawPath] [outPath]
import fs from 'node:fs';
import path from 'node:path';

const rawPath = process.argv[2] || 'data/raw/exercises.json';
const outPath = process.argv[3] || 'data/exercises.json';

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

/* ---------- 词表 ---------- */
// 噪声词：不影响中文名的展示
const NOISE = new Set(['male', 'female', 'v.', 'pov', 'image', 'equipment', 'exercise', 'variation',
  'reps', 'size', 'style', 'position', 'point', 'range', 'motion', 'sequence', 'response', 'self',
  'pro', 'of', 'with', 'on', 'in', 'to', 'and', 'for', 'from', 'at', 'by', 'into', 'off', 'through',
  'between', 'across', 'around', 'above', 'under', 'out', 'up', 'down', 'the', 'a', 'get', 'can',
  'on', 'over', 'against', 'into', 'upon', 'near', 'onto', 'behind-x']);

const DICT = {
  // 数字/角度
  '180': '180度', '360': '360度', '45°': '45度', '45в°': '45度', '45': '45度',
  '3/4': '3/4', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '8': '8',
  // 身体部位
  'ab': '腹', 'abdominal': '腹肌', 'abs': '腹肌', 'oblique': '腹斜肌', 'spine': '脊柱',
  'back': '背', 'upper': '上', 'lower': '下', 'middle': '中', 'inner': '内侧', 'outer': '外侧',
  'inside': '内侧', 'outside': '外侧', 'rear': '后', 'front': '前', 'side': '侧', 'posterior': '后侧',
  'chest': '胸', 'pec': '胸肌', 'pectoralis': '胸肌', 'shoulder': '肩', 'deltoid': '三角肌', 'delt': '三角肌',
  'arm': '臂', 'arms': '臂', 'bicep': '肱二头', 'biceps': '肱二头肌', 'tricep': '肱三头肌', 'triceps': '肱三头肌',
  'forearm': '前臂', 'forearms': '前臂', 'wrist': '腕', 'wrists': '腕', 'hand': '手', 'hands': '手',
  'finger': '指', 'thumb': '拇指', 'elbow': '肘', 'knee': '膝', 'knees': '膝', 'leg': '腿', 'legs': '腿',
  'legged': '腿', 'thigh': '大腿', 'quad': '股四头肌', 'quads': '股四头肌', 'hamstring': '腘绳肌',
  'hamstrings': '腘绳肌', 'glute': '臀', 'glutes': '臀肌', 'gluteus': '臀肌', 'calf': '小腿', 'calves': '小腿',
  'hip': '髋', 'groin': '腹股沟', 'ankle': '踝', 'ankles': '踝', 'foot': '脚', 'feet': '脚', 'toe': '脚趾',
  'heel': '脚跟', 'head': '头', 'neck': '颈', 'chin': '下巴', 'cheek': '颊', 'pelvic': '骨盆',
  'rectus': '直肌', 'femoris': '股二头肌', 'tibialis': '胫骨肌', 'peroneals': '腓骨肌',
  'lat': '背阔肌', 'lats': '背阔肌', 'trap': '斜方肌', 'traps': '斜方肌', 'rhomboid': '菱形肌',
  'scapula': '肩胛', 'scapular': '肩胛', 'rotator': '旋转', 'cuff': '肌群', 'sternum': '胸骨',
  'piriformis': '梨状肌', 'soleus': '比目鱼肌', 'abductor': '外展肌', 'adductor': '内收肌',
  'flexor': '屈肌', 'extensor': '伸肌', 'retractor': '收紧肌', 'depresor': '下压肌', 'levator': '提肌',
  // 器械
  'barbell': '杠铃', 'dumbbell': '哑铃', 'dumbbells': '哑铃', 'kettlebell': '壶铃', 'cable': '绳索',
  'band': '弹力带', 'bands': '弹力带', 'resistance': '阻力', 'machine': '器械', 'lever': '器械',
  'smith': '史密斯', 'ez': '曲杆', 'ez-bar': '曲杆', 'ez-barbell': '曲杆杠铃', 'sz-bar': '曲杆',
  'olympic': '奥林匹克', 'bar': '杆', 'bars': '杆', 't-bar': 'T杠', 'v-bar': 'V杠', 'rope': '绳索',
  'ropes': '绳索', 'ball': '球', 'medicine': '药球', 'stability': '稳定', 'bosu': '波速球',
  'bench': '凳', 'benches': '凳', 'chair': '椅', 'box': '箱', 'stepbox': '跳箱', 'platform': '台',
  'rack': '架', 'cage': '架', 'pad': '垫', 'floor': '地面', 'ground': '地面', 'wall': '墙',
  'roller': '滚轮', 'rollerer': '健腹轮', 'rollerout': '健腹轮', 'wheel': '轮', 'towel': '毛巾',
  'strap': '带', 'straps': '带', 'handle': '手柄', 'attachment': '把手', 'sled': '雪橇',
  'treadmill': '跑步机', 'bike': '单车', 'cycle': '单车', 'elliptical': '椭圆机', 'stepmill': '登山机',
  'ergometer': '测功仪', 'skierg': '滑雪机', 'tire': '轮胎', 'sledge': '大锤', 'hammer': '锤',
  'gripper': '握力器', 'ring': '吊环', 'suspension': '悬吊', 'weighted': '负重', 'bodyweight': '自重',
  'landmine': '地雷管', 'pulley': '滑轮', 'pin': '插销', 'sled-': '雪橇',
  // 姿势/方向
  'seated': '坐姿', 'sitted': '坐姿', 'standing': '站姿', 'kneeling': '跪姿', 'lying': '仰卧',
  'prone': '俯卧', 'supine': '仰卧', 'incline': '上斜', 'decline': '下斜', 'flat': '平板',
  'hanging': '悬垂', 'hang': '悬垂', 'suspended': '悬吊', 'assisted': '辅助', 'inverted': '倒置',
  'inverse': '反向', 'reverse': '反向', 'reversed': '反向', 'alternate': '交替', 'alternating': '交替',
  'single': '单', 'one': '单', 'two': '双', 'double': '双', 'both': '双', 'twin': '双', 'unilateral': '单侧',
  'close': '窄', 'narrow': '窄', 'wide': '宽', 'closer': '更窄', 'straddle': '分腿', 'split': '分腿',
  'staggered': '错步', 'side-to-side': '左右', 'up-down': '上下', 'bent': '屈', 'bend': '屈', 'bends': '屈',
  'bent-over': '俯身', 'straight': '直', 'stiff': '直腿', 'extended': '伸展', 'outstretched': '伸展',
  'upright': '直立', 'vertical': '垂直', 'horizontal': '水平', 'parallel': '平行', 'angled': '斜角',
  'cambered': '弧形', 'fixed': '固定', 'stationary': '固定', 'reclining': '斜卧', 'elevated': '抬高',
  'raised': '抬', 'deep': '深', 'half': '半', 'quarter': '四分之一', 'short': '短', 'semi': '半',
  'full': '全', 'low': '低', 'high': '高', 'air': '空中', 'gravity': '重力', 'dynamic': '动态',
  'isometric': '等长', 'negative': '退让', 'plyo': '增强式', 'power': '力量', 'speed': '速度',
  'quick': '快速', 'modified': '改良', 'advanced': '进阶', 'intermediate': '中级', 'basic': '基础',
  'astride': '跨立', 'facing': '面向', 'behind': '后', 'forward': '向前', 'backward': '向后',
  'upward': '向上', 'left': '左', 'right': '右', 'tilt': '倾斜', 'twist': '转体', 'twisted': '转体',
  'twisting': '转体', 'twists': '转体', 'rotation': '旋转', 'rotational': '旋转', 'rotary': '旋转',
  'rotate': '旋转', 'abduction': '外展', 'adduction': '内收', 'flexion': '屈', 'extension': '伸展',
  'hyperextension': '超伸展', 'hyper': '超伸', 'range': '幅度',
  // 握法
  'grip': '握', 'gripless': '无握', 'wide-grip': '宽握', 'close-grip': '窄握', 'reverse-grip': '反握',
  'overhand': '正手', 'underhand': '反手', 'neutral': '对握', 'pronated': '正握', 'pronation': '正握',
  'pronate-grip': '正握', 'supinated': '反握', 'supination': '反握', 'palm': '掌', 'palms': '掌',
  'palm-in': '掌心相对', 'clasped': '交扣', 'mixed': '混合', 'hook': '勾', 'alternated': '交替',
  // 动作
  'press': '推举', 'presses': '推举', 'push': '推', 'pull': '拉', 'pull-in': '收紧', 'row': '划船',
  'row_shoulder': '肩部划船', 'curl': '弯举', 'curls': '弯举', 'raise': '举', 'raises': '举',
  'fly': '飞鸟', 'flyes': '飞鸟', 'pullover': '仰卧上拉', 'pulldown': '下拉', 'pushdown': '下压',
  'push-up': '俯卧撑', 'push-ups': '俯卧撑', 'pull-up': '引体向上', 'pull-ups': '引体向上',
  'chin-up': '反手引体向上', 'chin-ups': '反手引体向上', 'muscle-up': '双力臂', 'dip': '臂屈伸',
  'dips': '臂屈伸', 'dip-pull-up': '双力臂', 'l-pull-up': 'L字引体向上', 'sit-up': '仰卧起坐',
  'sit-ups': '仰卧起坐', 'curl-up': '卷腹', 'crunch': '卷腹', 'crunches': '卷腹', 'squat': '深蹲',
  'squats': '深蹲', 'squatting': '深蹲', 'lunge': '弓步', 'lunge-s': '弓步', 'deadlift': '硬拉',
  'clean': '翻举', 'clean-grip': '翻举握', 'snatch': '抓举', 'jerk': '挺举', 'thruster': '火箭推',
  'shrug': '耸肩', 'kickback': '后踢', 'kickbacks': '后踢', 'kick': '踢', 'kicks': '踢', 'lift': '提',
  'lifting': '提', 'carry': '行走', 'walk': '行走', 'walking': '行走', 'run': '跑', 'runners': '跑者',
  'sprint': '冲刺', 'sprints': '冲刺', 'jump': '跳', 'jumps': '跳', 'hops': '跳', 'step': '踏步',
  'step-up': '登阶', 'march': '踏步', 'climb': '爬', 'crawl': '爬行', 'climber': '登山者',
  'mountain': '登山', 'stretch': '拉伸', 'swing': '摆荡', 'swimmer': '游泳', 'flutter': '打水',
  'bridge': '臀桥', 'plank': '平板支撑', 'pike': '屈体', 'jackknife': '折刀', 'burpee': '波比跳',
  'slam': '砸球', 'throw': '抛', 'clap': '击掌', 'twist-': '转体', 'wipers': '雨刷', 'windmill': '风车',
  'scissor': '剪刀', 'circle': '绕环', 'circles': '绕环', 'circular': '绕环', 'hold': '保持',
  'squeeze': '挤压', 'support': '支撑', 'supported': '支撑', 'stabilization': '稳定', 'balance': '平衡',
  'bicycle': '自行车', 'boxing': '拳击', 'judo': '柔道', 'tennis': '网球', 'yoga': '瑜伽', 'ski': '滑雪',
  'skater': '滑冰', 'kayak': '皮划艇', 'battling': '战绳', 'bowling': '保龄球', 'saw': '锯式',
  'tap': '点触', 'touch': '触', 'touchers': '触', 'reach': '触', 'roll': '滚', 'tap-': '点触',
  // 专名/流派
  'arnold': '阿诺德', 'bradford': '布拉德福德', 'cuban': '古巴', 'cossack': '哥萨克', 'gironda': '吉龙达',
  'goblet': '高脚杯', 'guillotine': '断头台', 'hack': '哈克', 'hindu': '印度', 'jefferson': '杰斐逊',
  'janda': '扬达', 'korean': '韩国', 'london': '伦敦', 'maltese': '马耳他', 'otis': '奥蒂斯',
  'pallof': '帕洛夫', 'pendlay': '潘德利', 'pistol': '手枪', 'planche': '俄式挺身', 'preacher': '牧师凳',
  'prisoner': '囚徒', 'renegade': '叛徒', 'romanian': '罗马尼亚', 'russian': '俄罗斯', 'scott': '斯科特',
  'sissy': '西西', 'skull': '碎颅', 'skullcrusher': '碎颅者', 'crusher': '碎颅者', 'sphinx': '狮身人面',
  'spider': '蜘蛛', 'sumo': '相扑', 'superman': '超人', 'svend': '斯文德', 'tate': '泰特',
  'turkish': '土耳其', 'waiter': '服务员', 'zercher': '泽奇', 'zottman': '佐特曼', 'jm': 'JM',
  'captains': '船长', 'crab': '蟹式', 'donkey': '驴式', 'frog': '蛙式', 'gorilla': '大猩猩',
  'inchworm': '毛毛虫', 'monster': '怪兽', 'pirate': '海盗', 'sphinx-': '狮身人面', 'stork': '鹳式',
  'butterfly': '蝴蝶', 'diamond': '钻石', 'star': '星形', 'figure': '四字', 'fours': '四点',
  'frankenstein': '僵尸', 'prisoner-': '囚徒', 'impossible': '极限', 'weaver': '织布机',
  'rocking': '摇摆', 'seesaw': '跷跷板', 'saw-': '锯式', 'scott-': '斯科特', 'potty': '蹲姿',
  'v': 'V', 'v-sit': 'V字支撑', 'v-up': 'V字起身', 'l-sit': 'L字支撑', 't': 'T', 't-raise': 'T字举',
  'y-raise': 'Y字举', 'w-press': 'W推举', 'pike-to-cobra': '屈体转眼镜蛇', 'elbow-to-knee': '肘触膝',
  'leg-hip': '腿髋', 'glute-ham': '臀腿', 'arm-': '臂', 'body-up': '挺身', 'butt-ups': '抬臀',
  'bottoms': '底部', 'bottoms-up': '倒置', 'good': '早安', 'morning': '挺身', 'jack': '开合',
  'leverage': '器械', 'smith-': '史密斯', 'sled-': '雪橇', 'cross': '交叉', 'crossover': '交叉',
  'cross-over': '交叉', 'crossovers': '交叉', 'gripper-': '握力器', 'rope-': '绳索',
  'concentration': '集中', 'preacher-': '牧师凳', 'close-': '窄', 'wide-': '宽', 'pike-': '屈体',
  'march-': '踏步', 'hop': '跳', 'hips': '髋', 'spine-': '脊柱', 'back-': '背',
  'overhead': '过头', 'lateral': '侧', 'bell': '铃', 'blaster': '训练器', 'body': '身体', 'revers': '反向',
  'stance': '站姿', 'drop': '落下', 'archer': '弓箭手', 'external': '外旋', 'internal': '内旋',
  'french': '法式', 'pass': '过', 'rocky': '洛奇', 'iron': '铁', 'three': '三', 'drag': '拉',
  'face': '面', 'handstand': '倒立', 'flip': '翻转', 'sit': '坐', 'tuck': '收腹', 'plus': '加',
  'major': '主要', 'depth': '深度', 'release': '释放', 'multiple': '多', 'clock': '钟',
  'pyramid': '金字塔', 'hug': '抱', 'dog': '狗', 'catch': '接', 'kipping': '借力', 'round': '圆',
  'skier': '滑雪', 'world': '世界', 'drive': '驱动', 'peacher': '牧师凳', 'apart': '分开',
  'slide': '滑', 'board': '板', 'two-one': '二合一', 'big': '大', 'degrees': '度', 'femoral': '股',
  'contralateral': '对侧', 'angle': '角度', 'all': '全', 'curtsey': '交叉', 'staircase': '楼梯',
  'knife': '刀', 'cocoons': '茧式', 'flag': '旗', 'lean': '倾', 'wind': '风', 'forth': '前',
  'stride': '跨步', 'bear': '熊', 'slingers': '甩摆', 'ted': '', 'ups': '', 'pose': '', 'hyght': '',
  'thibaudeau': '', 'supper': '', 'stirrups': '', 'stalder': '', 'squad': '', 'keens': '',
  'fallout': '', 'spellcaster': '', 'elevator': '',

};

// 词组级替换（先于分词执行），修正英文固定搭配
const PHRASES = [
  ['45 degrees', '45度'], ['45 degree', '45度'], ['glute bridge', '臀桥'], ['hip thrusts', '臀推'],
  ['hip thrust', '臀推'], ['leg press', '腿举'], ['calf press', '提踵推举'], ['face pull', '面拉'],
  ['smith machine', '史密斯机'], ['pull through', '髋拉'], ['behind head', '颈后'],
  ['cross body', '交叉'], ['exercise ball', '瑞士球'], ['self assisted', '自主辅助'],
  ['biceps femoris', '股二头肌'], ['good morning', '早安挺身'], ['good mornings', '早安挺身'],
  ["farmer's carry", '农夫行走'], ['farmers carry', '农夫行走'], ['farmers walk', '农夫行走'],
  ['captains chair', '船长椅'], ['power clean', '高翻'], ['power snatch', '高抓'],
  ['skull crusher', '碎颅者'], ['skull crushers', '碎颅者'], ['jump squat', '深蹲跳'],
  ['jump squats', '深蹲跳'], ['jump lunge', '弓步跳'], ['jump rope', '跳绳'],
  ['jump press', '跳跃推举'], ['jump pull-up', '跳跃引体向上'], ['jump dip', '跳跃臂屈伸'],
  ['jump step', '跳跃登阶'], ['jump split', '跳跃分腿'], ['jump twist', '跳跃转体'],
  ['jump jack', '开合跳'], ['jump squat-', '深蹲跳'], ['squat jump', '深蹲跳'],
  ['romanian deadlift', '罗马尼亚硬拉'], ['sumo deadlift', '相扑硬拉'], ['stiff leg deadlift', '直腿硬拉'],
  ['stiff-legged deadlift', '直腿硬拉'], ['single leg deadlift', '单腿硬拉'],
  ['one leg deadlift', '单腿硬拉'], ['turkish get up', '土耳其起立'], ['turkish get-up', '土耳其起立'],
  ['clean and jerk', '挺举'], ['clean and press', '翻举推举'], ['snatch grip', '抓举握'],
  ['muscle up', '双力臂'], ['pull up', '引体向上'], ['push up', '俯卧撑'], ['sit up', '仰卧起坐'],
  ['chin up', '反手引体向上'], ['step up', '登阶'], ['warm up', '热身'], ['l sit', 'L字支撑'],
  ['v sit', 'V字支撑'], ['v up', 'V字起身'], ['t bar', 'T杠'], ['ez bar', '曲杆'],
  ['one arm', '单臂'], ['one leg', '单腿'], ['single arm', '单臂'], ['single leg', '单腿'],
  ['both arms', '双臂'], ['two arm', '双臂'], ['two arms', '双臂'], ['double arm', '双臂'],
  ['bent over', '俯身'], ['bent-over', '俯身'], ['in and out', '内外'], ['side bend', '侧屈'],
  ['side bends', '侧屈'], ['leg raise', '举腿'], ['leg raises', '举腿'], ['knee raise', '举膝'],
  ['hip thrust', '臀推'], ['hip thrusts', '臀推'], ['calf raise', '提踵'], ['calf raises', '提踵'],
  ['toe raise', '勾脚尖'], ['wrist curl', '腕弯举'], ['wrist curls', '腕弯举'],
  ['lat pulldown', '高位下拉'], ['lat pull-down', '高位下拉'], ['seated row', '坐姿划船'],
  ['bench press', '卧推'], ['bench presses', '卧推'], ['chest press', '推胸'], ['shoulder press', '肩推'],
  ['military press', '军事推举'], ['overhead press', '过头推举'], ['leg press', '腿举'],
  ['leg curl', '腿弯举'], ['leg curls', '腿弯举'], ['leg extension', '腿屈伸'],
  ['leg extensions', '腿屈伸'], ['leg raise-', '举腿'], ['leg curl-', '腿弯举'],
  ['romanian-', '罗马尼亚'], ['lateral raise', '侧平举'], ['lateral raises', '侧平举'],
  ['front raise', '前平举'], ['rear delt', '后束'], ['rear deltoid', '后束'],
  ['bicep curl', '肱二头弯举'], ['biceps curl', '肱二头弯举'], ['triceps extension', '肱三头伸展'],
  ['push down', '下压'], ['pull down', '下拉'], ['pull over', '仰卧上拉'], ['pull in', '收紧'],
  ['kick back', '后踢'], ['sit-up', '仰卧起坐'], ['sit-ups', '仰卧起坐'],
];

const CATEGORY_ZH = {
  'upper arms': '上臂', 'upper legs': '上腿', 'back': '背部', 'waist': '腰腹', 'chest': '胸部',
  'shoulders': '肩部', 'lower legs': '小腿', 'lower arms': '前臂', 'cardio': '有氧', 'neck': '颈部',
};

const EQUIP_ZH = {
  'body weight': '自重', 'dumbbell': '哑铃', 'cable': '绳索', 'barbell': '杠铃',
  'leverage machine': '固定器械', 'band': '弹力带', 'smith machine': '史密斯机', 'kettlebell': '壶铃',
  'weighted': '负重', 'stability ball': '瑞士球', 'ez barbell': '曲杆杠铃', 'assisted': '辅助器械',
  'sled machine': '雪橇机', 'medicine ball': '药球', 'rope': '绳索', 'roller': '滚轮',
  'resistance band': '阻力带', 'bosu ball': '波速球', 'olympic barbell': '奥林匹克杠铃',
  'wheel roller': '健腹轮', 'upper body ergometer': '上肢测功仪', 'skierg machine': '滑雪机',
  'hammer': '锤', 'stationary bike': '动感单车', 'tire': '轮胎', 'trap bar': '六角杠铃',
  'elliptical machine': '椭圆机', 'stepmill machine': '登山机',
};

const TARGET_ZH = {
  'abductors': '外展肌', 'abs': '腹肌', 'adductors': '内收肌', 'biceps': '肱二头肌', 'calves': '小腿',
  'cardiovascular system': '心肺', 'delts': '三角肌', 'forearms': '前臂', 'glutes': '臀肌',
  'hamstrings': '腘绳肌', 'lats': '背阔肌', 'levator scapulae': '肩胛提肌', 'pectorals': '胸大肌',
  'quads': '股四头肌', 'serratus anterior': '前锯肌', 'spine': '竖脊肌', 'traps': '斜方肌',
  'triceps': '肱三头肌', 'upper back': '上背',
};

const MUSCLE_ZH = {
  'abdominals': '腹肌', 'ankle stabilizers': '踝稳定肌', 'ankles': '踝', 'biceps': '肱二头肌',
  'calves': '小腿', 'chest': '胸', 'core': '核心', 'deltoids': '三角肌', 'forearms': '前臂',
  'glutes': '臀肌', 'hamstrings': '腘绳肌', 'hands': '手', 'hip flexors': '髂腰肌',
  'latissimus dorsi': '背阔肌', 'lats': '背阔肌', 'lower back': '下背', 'obliques': '腹斜肌',
  'quadriceps': '股四头肌', 'rhomboids': '菱形肌', 'rotator cuff': '肩袖', 'shoulders': '肩',
  'soleus': '比目鱼肌', 'trapezius': '斜方肌', 'traps': '斜方肌', 'triceps': '肱三头肌',
  'upper back': '上背', 'wrist extensors': '腕伸肌', 'wrist flexors': '腕屈肌', 'wrists': '腕',
  'brachialis': '肱肌', 'grip muscles': '握力肌', 'inner thighs': '大腿内侧', 'lower abs': '下腹',
  'rear deltoids': '三角肌后束', 'shins': '小腿前侧', 'sternocleidomastoid': '胸锁乳突肌',
  'upper chest': '上胸', 'back': '背', 'feet': '脚', 'groin': '腹股沟', 'ankle': '踝',
};


// 常见中文同义词（让「平板支撑」「臀桥」这类通用词也能搜到合适的条目）
const AKA = {
  '负重平板支撑': ['平板支撑', '平板', 'plank'],
  '前平板支撑转体': ['平板支撑'],
  '侧平板支撑髋内收': ['侧平板支撑'],
  '臀桥': ['桥式'],
  '杠铃臀桥': ['臀桥'],
  '低臀桥地面': ['臀桥'],
  '臀推': ['髋推'],
  '弹力带跪姿臀推': ['臀推'],
  '高位下拉': ['下拉'],
  '绳索高位下拉（全幅度）': ['高位下拉', '下拉'],
  '坐姿划船': ['划船'],
  '提踵': ['小腿'],
  '杠铃站姿提踵': ['提踵'],
  '坐姿提踵': ['提踵'],
  '耸肩': ['斜方'],
  '杠铃耸肩': ['耸肩'],
  '侧平举': ['侧举'],
  '哑铃侧平举': ['侧平举'],
  '前平举': ['前举'],
  '哑铃前平举': ['前平举'],
  '锤式弯举': ['锤式'],
  '哑铃锤式弯举': ['锤式弯举'],
  '臂屈伸': ['三头'],
  '双杠臂屈伸': ['臂屈伸', '双杠'],
  '卷腹': ['腹部'],
  '引体向上': ['引体'],
  '面拉': ['绳索面拉'],
  '俯卧撑': ['pushup'],
  '深蹲': ['squat'],
  '硬拉': ['deadlift'],
  '卧推': ['bench'],
};

/* ---------- 规范化与去重 ---------- */
// 去掉机位/性别/版本后缀，识别重复条目
export function canonKey(en) {
  return String(en).toLowerCase()
    .replace(/\((?:\s*(?:back|side|front)\s*pov\s*)\)/g, '')
    .replace(/\((?:\s*(?:male|female)\s*)\)/g, '')
    .replace(/\bv\.\s*\d+\b/g, '')
    .replace(/45[вb]°/g, '45°')
    .replace(/\s+/g, ' ').trim();
}

// 展示用英文名：去掉机位/性别/版本后缀
export function displayEn(en) {
  return String(en)
    .replace(/\s*\(\s*(?:back|side|front)\s*pov\s*\)/gi, '')
    .replace(/\s*\(\s*(?:male|female)\s*\)/gi, '')
    .replace(/\s*\bv\.\s*\d+\b/gi, '')
    .replace(/\s+/g, ' ').trim();
}

// 常见动作的人工校对名（键为 canonKey）
const NAME_OVERRIDES = {
  'barbell full squat': '杠铃深蹲',
  'barbell low bar squat': '杠铃低杠深蹲',
  'barbell bench front squat': '杠铃前蹲',
  'barbell clean-grip front squat': '杠铃前蹲（翻握）',
  'sled 45° leg press': '45° 腿举机',
  'lever leg extension': '坐姿腿屈伸',
  'lever seated leg curl': '坐姿腿弯举',
  'lever lying leg curl': '俯卧腿弯举',
  'lever seated calf raise': '坐姿提踵',
  'lever standing calf raise': '站姿提踵（器械）',
  'lever seated row': '坐姿划船',
  'lever shoulder press': '器械肩推',
  'lever chest press': '器械推胸',
  'lever incline chest press': '上斜推胸',
  'lever lat pulldown': '高位下拉',
  'lever pullover': '器械仰卧上拉',
  'lever leg press': '腿举机',
  'barbell glute bridge': '杠铃臀桥',
  'glute bridge': '臀桥',
  'glute bridge march': '臀桥踏步',
  'barbell hip thrust': '杠铃臀推',
  'resistance band hip thrusts on knees': '弹力带跪姿臀推',
  'barbell bent over row': '杠铃俯身划船',
  'barbell one arm bent over row': '杠铃单臂划船',
  'barbell pendlay row': '杠铃潘德利划船',
  'barbell incline row': '杠铃上斜划船',
  'cable low seated row': '坐姿绳索划船',
  'cable straight back seated row': '坐姿绳索划船（直背）',
  'cable pushdown': '绳索下压',
  'cable triceps pushdown (v-bar)': 'V 杠绳索下压',
  'cable one arm tricep pushdown': '绳索单臂下压',
  'cable reverse-grip pushdown': '绳索反握下压',
  'cable incline pushdown': '绳索上斜下压',
  'cable crossover': '绳索夹胸',
  'cable cross-over': '绳索夹胸',
  'cable cross-over variation': '绳索夹胸',
  'cable fly': '绳索飞鸟',
  'dumbbell fly': '哑铃飞鸟',
  'dumbbell bench press': '哑铃卧推',
  'dumbbell incline bench press': '哑铃上斜卧推',
  'dumbbell decline bench press': '哑铃下斜卧推',
  'dumbbell seated shoulder press (parallel grip)': '哑铃坐姿肩推（对握）',
  'dumbbell biceps curl': '哑铃弯举',
  'dumbbell hammer curl': '哑铃锤式弯举',
  'barbell standing wide military press': '杠铃站姿宽握肩推',
  'barbell standing close grip military press': '杠铃站姿窄握肩推',
  'barbell seated behind head military press': '杠铃坐姿颈后推举',
  'barbell upright row': '杠铃直立划船',
  'barbell wide-grip upright row': '杠铃宽握直立划船',
  'barbell shrug': '杠铃耸肩',
  'barbell curl': '杠铃弯举',
  'barbell romanian deadlift': '杠铃罗马尼亚硬拉',
  'barbell straight leg deadlift': '杠铃直腿硬拉',
  'barbell sumo deadlift': '杠铃相扑硬拉',
  'barbell deadlift': '杠铃硬拉',
  'barbell hack squat': '杠铃哈克深蹲',
  'barbell rear lunge': '杠铃后撤弓步',
  'barbell lunge': '杠铃弓步',
  'front plank': '平板支撑',
  'weighted front plank': '负重平板支撑',
  'side plank': '侧平板支撑',
  'front plank with twist': '平板支撑转体',
  'chest dip': '双杠臂屈伸',
  'triceps dip': '双杠臂屈伸（三头）',
  'bench dip': '凳上臂屈伸',
  'pull-up': '引体向上',
  'chin-up': '反手引体向上',
  'wide grip pull-up': '宽握引体向上',
  'assisted pull-up': '辅助引体向上',
  'inverted row': '反向划船',
  'hanging leg raise': '悬垂举腿',
  'russian twist': '俄罗斯转体',
  'bicycle crunch': '自行车卷腹',
  'hanging pike': '悬垂屈体',
  'farmers walk': '农夫行走',
  'kettlebell swing': '壶铃摆荡',
  'smith machine squat': '史密斯深蹲',
  'smith squat': '史密斯深蹲',
  'smith leg press': '史密斯腿举',
  'cable lateral pulldown': '绳索侧下拉',
  'cable straight arm pulldown': '绳索直臂下拉',
  'cable rear pulldown': '绳索后下拉',
  'cable underhand pulldown': '绳索反手下拉',
  'cable lat pulldown full range of motion': '绳索高位下拉（全幅度）',
  'reverse grip machine lat pulldown': '反握高位下拉',
  'twin handle parallel grip lat pulldown': '对握高位下拉',
  'lever seated leg press': '坐姿腿举',
  'lever horizontal one leg press': '器械单腿腿举',
  'lever alternate leg press': '器械交替腿举',

  // 常用但原数据集只有相近动作的命名统一，方便中文搜索
  'barbell bench press': '杠铃卧推',
  'barbell incline bench press': '杠铃上斜卧推',
  'barbell decline bench press': '杠铃下斜卧推',
  'barbell seated calf raise': '杠铃坐姿提踵',
  'barbell standing calf raise': '杠铃站姿提踵',
  'barbell standing leg calf raise': '杠铃单腿提踵',
  'dumbbell lateral raise': '哑铃侧平举',
  'dumbbell front raise': '哑铃前平举',
  'dumbbell shrug': '哑铃耸肩',
  'dumbbell lunge': '哑铃弓步',
  'dumbbell step-up': '哑铃登阶',
  'dumbbell romanian deadlift': '哑铃罗马尼亚硬拉',
  'dumbbell goblet squat': '哑铃高脚杯深蹲',
  'dumbbell one arm row': '哑铃单臂划船',
  'dumbbell concentration curl': '哑铃集中弯举',
  'dumbbell preacher curl': '哑铃牧师凳弯举',
  'dumbbell triceps extension': '哑铃臂屈伸',
  'dumbbell overhead triceps extension': '哑铃过头臂屈伸',
  'dumbbell rear delt raise': '哑铃俯身后束举',
};

/* ---------- 生成中文名 ---------- */
function hasCJK(s) { return /[\u4e00-\u9fa5]/.test(s); }

function zhName(en) {
  const key = canonKey(en);
  if (NAME_OVERRIDES[key]) return NAME_OVERRIDES[key];

  // 括号里的内容通常是器械说明，前置更符合中文习惯
  let src = en.trim();
  const paren = src.match(/\(([^)]*)\)/);
  let prefix = '';
  if (paren) {
    prefix = paren[1].replace(/^with\s+/i, '').trim();
    src = src.replace(paren[0], ' ').trim();
  }
  src = (prefix ? prefix + ' ' : '') + src;
  let s = ' ' + src.toLowerCase().replace(/\s+/g, ' ').trim() + ' ';
  // 词组替换：短词优先避免误伤，按长度倒序匹配
  for (const [from, to] of [...PHRASES].sort((a, b) => b[0].length - a[0].length)) {
    s = s.split(from).join(' ' + to + ' ');
  }
  const tokens = s.split(/[\s()]+/).filter(Boolean);
  const out = tokens.map(t => {
    if (hasCJK(t)) return t;
    const key = t.replace(/^[,.;]+|[,.;]+$/g, '');
    if (DICT[key]) return DICT[key];
    if (NOISE.has(key)) return '';
    return key; // 未收录 -> 保留英文
  }).filter(Boolean);

  let name = out.join('').replace(/\s+/g, ' ').trim();
  // 连续重复的中文片段去重（绳索绳索 -> 绳索）
  for (let i = 0; i < 3; i++) name = name.replace(/([\u4e00-\u9fa5]{2,5})\1/g, '$1');
  // 修饰词顺序修正：跳/交替/单 类前缀在中文里常后置
  name = name.replace(/^跳(深蹲|弓步|俯卧撑|引体向上|划船|推举|臂屈伸|分腿|登阶|转身)/, '$1跳');
  // 数字与中文之间的空格清理
  name = name.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2');
  // 单字叠词去重：臀臀桥 -> 臀桥、45度度 -> 45度
  for (const ch of ['臀', '度', '球', '铃', '杆', '绳', '握', '凳', '椅', '轮']) {
    name = name.split(ch + ch).join(ch);
  }
  name = name.replace(/^[\s-]+|[\s-]+$/g, '');
  return name || en;
}

/* ---------- 输出 ---------- */
// 同一动作的机位/性别/版本变体只保留一个（优先 back pov）
const byCanon = new Map();
for (const x of raw) {
  const key = canonKey(x.name);
  const prev = byCanon.get(key);
  if (!prev) { byCanon.set(key, x); continue; }
  const score = (n) => (/\(back pov\)/i.test(n) ? 2 : /\((?![^)]*pov)/.test(n) ? 1 : 0);
  if (score(x.name) > score(prev.name)) byCanon.set(key, x);
}
const deduped = [...byCanon.values()];

const items = deduped.map(x => {
  const steps = (x.instruction_steps && (x.instruction_steps.zh || x.instruction_steps.en)) || [];
  const zh = zhName(x.name);
  return {
    id: String(x.id),
    en: displayEn(x.name),
    zh,
    cat: x.category,
    catZh: CATEGORY_ZH[x.category] || x.category,
    body: x.body_part,
    equip: x.equipment,
    equipZh: EQUIP_ZH[x.equipment] || x.equipment,
    target: x.target || '',
    targetZh: TARGET_ZH[x.target] || x.target || '',
    muscle: x.muscle_group || '',
    muscleZh: MUSCLE_ZH[x.muscle_group] || x.muscle_group || '',
    secondary: (x.secondary_muscles || []).map(m => MUSCLE_ZH[m] || m),
    img: x.image ? x.image.replace('images/', '') : '',
    gif: x.gif_url ? x.gif_url.replace('videos/', '') : '',
    steps: steps.map(s => s.trim()),
    kw: [zh, x.name, ...(AKA[zh] || [])].join(' '),
    attribution: '© Gym visual — gymvisual.com',
  };
});

// 按分类排序，方便前端展示
const order = ['chest', 'back', 'shoulders', 'upper arms', 'lower arms', 'upper legs', 'lower legs', 'waist', 'cardio', 'neck'];
items.sort((a, b) => (order.indexOf(a.cat) - order.indexOf(b.cat)) || a.zh.localeCompare(b.zh, 'zh'));

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(items), 'utf8');
console.log(`[build-data] ${items.length} exercises (原始 ${raw.length}，去重 ${raw.length - items.length}) -> ${outPath}`);
const samples = ['barbell bench press', 'dumbbell incline bench press', 'cable lat pulldown', 'barbell squat', 'dumbbell lateral raise', 'jump squat', 'concentration curls'];
for (const s of samples) {
  const hit = items.find(i => i.en.toLowerCase() === s);
  if (hit) console.log(`  ${hit.en} -> ${hit.zh}`);
}
