/**
 * 肌肉部位示意图（基于 MuscleMap 开源矢量数据，MIT）
 * https://github.com/Jsplice/MuscleMap —— @musclemap/assets
 * 正面/背面人体轮廓 + 每块肌肉独立 path，按主/协同肌群高亮；
 * 颜色全部走 CSS 变量，自动跟随深浅色模式。
 */

/* 数据集里的肌群名（英文 + 中文）→ 图上可高亮的部位 key */
const GROUP_RULES = [
  [/(pectoral|chest|胸)/i, 'chest'],
  [/(latissimus|\blats?\b|背阔)/i, 'lats'],
  [/(upper back|rhomboid|菱形|中背)/i, 'upperBack'],
  [/(trap|斜方)/i, 'traps'],
  [/(oblique|腹外斜|腹斜)/i, 'obliques'],
  [/(rectus abdom|abdominal|\babs\b|\bcore\b|腹肌|核心)/i, 'abs'],
  [/(serratus|前锯)/i, 'serratus'],
  [/(deltoid|\bdelts?\b|shoulder|三角|肩)/i, 'shoulders'],
  [/(biceps?|肱二头)/i, 'biceps'],
  [/(triceps?|肱三头)/i, 'triceps'],
  [/(forearm|wrist|肱桡|前臂|腕)/i, 'forearms'],
  [/(erector|spine|lower back|竖脊|下背|腰椎)/i, 'lowerBack'],
  [/(glute|臀)/i, 'glutes'],
  [/(quadriceps|\bquads?\b|股四|大腿前)/i, 'quads'],
  [/(hamstring|股二头|腘绳)/i, 'hamstrings'],
  [/(calves|calf|soleus|gastrocnemius|小腿|比目鱼)/i, 'calves'],
  [/(adductor|内收)/i, 'adductors'],
  [/(abductor|外展)/i, 'abductors'],
  [/(hip flexor|iliopsoas|髋屈|髂腰)/i, 'hipFlexors'],
  [/(neck|levator|颈)/i, 'neck'],
  [/(cardiovascular|heart|全身|心肺)/i, 'fullBody'],
];

export const GROUP_LABELS = {
  chest: '胸大肌', shoulders: '三角肌', biceps: '肱二头', triceps: '肱三头', forearms: '前臂',
  abs: '腹直肌', obliques: '腹斜肌', serratus: '前锯肌', traps: '斜方肌', upperBack: '菱形肌 / 中背',
  lats: '背阔肌', lowerBack: '竖脊肌 / 下背', glutes: '臀肌', quads: '股四头肌', hamstrings: '腘绳肌',
  adductors: '内收肌', abductors: '外展肌', hipFlexors: '髋屈肌', calves: '小腿三头肌', neck: '颈部', fullBody: '全身',
};

function toGroup(name) {
  for (const [re, key] of GROUP_RULES) if (re.test(String(name))) return key;
  return null;
}

/** 从动作数据推断主/协同肌群（muscle 字段是数据集的协同肌，归入 secondary） */
export function musclesForExercise(ex) {
  if (!ex) return { primary: [], secondary: [] };
  const primary = new Set();
  const secondary = new Set();
  for (const s of [ex.target, ex.targetZh]) {
    const g = toGroup(s);
    if (g) primary.add(g);
  }
  for (const s of [...(ex.secondary || []), ex.muscle, ex.muscleZh]) {
    const g = toGroup(s);
    if (g && !primary.has(g)) secondary.add(g);
  }
  for (const g of primary) secondary.delete(g);
  return { primary: [...primary], secondary: [...secondary] };
}

/* ------------------------------------------------------------------ */
/* 人体矢量图（MuscleMap 数据，MIT）                                    */
/* 轮廓 + 每块肌肉一条 path，左/右各自独立绘制，无需镜像。               */
/* ------------------------------------------------------------------ */
import { MUSCLE_FRONT, MUSCLE_BACK } from './vendor/musclemap.js';

/* 我们的部位 key → MuscleMap 表面 ID */
const SURFACES = {
  chest: ['CHEST_LEFT', 'CHEST_RIGHT'],
  shoulders: ['SHOULDER_FRONT_LEFT', 'SHOULDER_FRONT_RIGHT', 'SHOULDER_SIDE_LEFT', 'SHOULDER_SIDE_RIGHT', 'SHOULDER_REAR_LEFT', 'SHOULDER_REAR_RIGHT'],
  biceps: ['BICEPS_LEFT', 'BICEPS_RIGHT'],
  triceps: ['TRICEPS_LEFT', 'TRICEPS_RIGHT'],
  forearms: ['FOREARM_LEFT', 'FOREARM_RIGHT'],
  abs: ['CORE_LEFT', 'CORE_RIGHT'],
  obliques: ['OBLIQUE_LEFT', 'OBLIQUE_RIGHT'],
  traps: ['TRAPEZIUS_LEFT', 'TRAPEZIUS_RIGHT'],
  upperBack: ['RHOMBOID_LEFT', 'RHOMBOID_RIGHT'],
  lats: ['LATISSIMUS_LEFT', 'LATISSIMUS_RIGHT'],
  lowerBack: ['LOWER_BACK_LEFT', 'LOWER_BACK_RIGHT'],
  glutes: ['GLUTEUS_LEFT', 'GLUTEUS_RIGHT'],
  quads: ['QUADRICEPS_LEFT', 'QUADRICEPS_RIGHT'],
  hamstrings: ['HAMSTRINGS_LEFT', 'HAMSTRINGS_RIGHT'],
  calves: ['CALVES_LEFT', 'CALVES_RIGHT'],
  adductors: ['ADDUCTOR_LEFT', 'ADDUCTOR_RIGHT'],
  abductors: ['ABDUCTOR_LEFT', 'ABDUCTOR_RIGHT'],
  // serratus / hipFlexors / neck / fullBody 无对应表面，仅在文字标签中体现
};

function renderFigure(data, primary, secondary, label) {
  const pri = new Set(primary.flatMap(g => SURFACES[g] || []));
  const sec = new Set(secondary.flatMap(g => SURFACES[g] || []).filter(id => !pri.has(id)));
  const muscles = data.muscles
    .map(m => `<path class="mmp ${pri.has(m.id) ? 'on-primary' : sec.has(m.id) ? 'on-secondary' : ''}" d="${m.d}"/>`)
    .join('');
  const body = data.outline.map(d => `<path class="mm-body" d="${d}"/>`).join('');
  return `
    <figure class="mm-fig">
      <svg viewBox="${data.viewBox}" role="img" aria-label="${label}肌肉示意">${body}${muscles}</svg>
      <figcaption>${label}</figcaption>
    </figure>`;
}

/** 返回肌肉示意图 HTML */
export function muscleMap(ex) {
  const { primary, secondary } = musclesForExercise(ex);
  if (primary.includes('fullBody')) {
    return `
      <div class="mm">
        ${renderFigure(MUSCLE_FRONT, [], [], '正面')}
        ${renderFigure(MUSCLE_BACK, [], [], '背面')}
      </div>
      <p class="mm-note">全身性有氧动作，参与肌群随节奏与动作模式变化，图示仅供参考。</p>`;
  }
  const hasAny = primary.length || secondary.length;
  return `
    <div class="mm">
      ${renderFigure(MUSCLE_FRONT, primary, secondary, '正面')}
      ${renderFigure(MUSCLE_BACK, primary, secondary, '背面')}
    </div>
    <div class="mm-legend">
      <span><i class="dot primary"></i>主要刺激</span>
      <span><i class="dot secondary"></i>协同参与</span>
      ${hasAny ? '' : '<span class="muted">整体协调发力</span>'}
    </div>`;
}

/** 供文本展示：主要/协同肌群的中文名 */
export function muscleLabelList(ex) {
  const { primary, secondary } = musclesForExercise(ex);
  return {
    primary: primary.map(g => GROUP_LABELS[g]).filter(Boolean),
    secondary: secondary.map(g => GROUP_LABELS[g]).filter(Boolean),
  };
}
