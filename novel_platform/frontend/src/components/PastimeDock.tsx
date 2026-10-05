import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Gamepad2, Keyboard, Quote, Dices, RotateCcw, Timer, Lightbulb, Trophy } from "lucide-react";

/**
 * 摸鱼一下 · 全站悬浮坞
 * 生成小说动辄几分钟到几十分钟，用户干等会无聊。
 * 三个纯前端本地小功能：码字挑战 / 金句盲盒 / 剧情骰子。
 * 无任何 API 依赖，打开即玩，关掉不留痕。
 */

const SENTENCES = [
  "他握紧手中那柄锈迹斑斑的剑，迎着漫天风雪，一步一步走向山门的方向。",
  "三千年了，这座封印之下埋着的，从来不是妖魔，而是她最后一缕残魂。",
  "灵气复苏的那一夜，全城的狗都对着月亮跪了下来，只有他家的猫没有。",
  "赘婿三年，今日一纸休书，整个江城都不知道他们放走了一条什么样的龙。",
  "她在机甲驾驶舱里睁开眼，耳边响起一个陌生又熟悉的声音：欢迎回来，舰长。",
  "别人修仙靠灵根，他修仙靠吵架，吵赢一次，境界便松动一分。",
  "末世第七年，人类最后的图书馆里，守馆人每天都要给不存在的读者开门。",
  "他重生了，回到了高考前一百天，可考卷上的题目他一道都不认识。",
  "那条龙盘在城楼上打盹，已经三百年没有动过了，人们早已把它当成了雕塑。",
  "掌门说他是百年不遇的废材，只有他自己知道，丹田里沉着的是一整片星海。",
];

const QUOTES = [
  "天不生我李淳罡，剑道万古如长夜。",
  "三十年河东，三十年河西，莫欺少年穷。",
  "我命由我不由天，天欲灭我我灭天。",
  "待到阴阳逆乱时，我以魔血染青天。",
  "世间文字八万个，唯有情字最杀人。",
  "一人挑尽人间事，从此江湖无故人。",
  "不为成仙，只为在红尘中等你归来。",
  "若本世子身死，徐骁必叫你广陵满城尽悬北凉刀。",
  "剑来！",
  "魔前一叩三千年，回首凡尘不做仙。",
  "生我何用，不能欢笑；灭我何用，不减狂骄。",
  "这天下，没有本座不敢去的地方。",
  "你若是佛，天下无魔；你若是魔，佛奈你何。",
  "宁可枝头抱香死，何曾吹落北风中。——但我不一样，我要做那阵北风。",
  "他日若遂凌云志，敢笑黄巢不丈夫。",
  "醉卧沙场君莫笑，古来征战几人回。——可我，回来了。",
  "万古青天一株莲，唯有虚空一声叹。",
  "我有一剑，可搬山、倒海、降妖、镇魔、敕神、摘星、断江、摧城、开天！",
  "命运啊，你休想让我跪下来求你。",
  "此去经年，应是良辰好景虚设。——才怪，我的良辰，我自己造。",
];

const SETTINGS = [
  "废材开局：全村灵根测试，只有他一个人没有反应",
  "天降系统：但系统的任务全是让他社死",
    "穿越成反派：主角还有三章就要来退婚了",
  "末世囤货：他重生在丧尸爆发前七十二小时",
  "宗门垫底：外门扫地杂役，扫的是镇派神兽的窝",
  "无限流：每次死亡都会继承上一世的全部技能",
  "星际流亡：全舰最后一个人类，和一台话痨AI",
  "都市隐世：他是已经隐退的地下世界之王",
];

const TWISTS = [
  "金手指竟然是最终反派种下的饵",
  "最信任的师父，正是灭他满门的元凶",
  "所谓末世，其实是一场筛选实验",
  "系统发布的任务，在悄悄改写他的记忆",
  "退婚流反转：被退婚的才是真正的天命之子",
  "他以为的重生，其实是第七次轮回",
  "全书最大的机缘，藏在开局随手丢掉的东西里",
  "反派得知了剧情，正在按剧本反向布局",
];

const ENDINGS = [
  "以凡人之躯，斩落天上的仙",
  "放弃飞升，留在人间开了间小酒馆",
  "与反派同归于尽，却在番外被读者联名复活",
  "发现一切是梦，但枕边多了一枚真的储物戒指",
  "赢下了全世界，然后把它还给了所有人",
  "打破了第四面墙，对读者说了声谢谢",
  "无敌之后，选择封印修为重新练级",
  "带着所有人一起飞升：这次，一个都不丢下",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ---------- 码字挑战 ---------- */

type TypingPhase = "idle" | "typing" | "result";

function TypeChallenge() {
  const [phase, setPhase] = useState<TypingPhase>("idle");
  const [sentence, setSentence] = useState("");
  const [typed, setTyped] = useState("");
  const [timeLeft, setTimeLeft] = useState(30);
  const timerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const finish = () => {
    stopTimer();
    setPhase("result");
  };

  const start = () => {
    stopTimer();
    setSentence(pick(SENTENCES));
    setTyped("");
    setTimeLeft(30);
    setPhase("typing");
    setTimeout(() => inputRef.current?.focus(), 50);
    timerRef.current = window.setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { finish(); return 0; }
        return t - 1;
      });
    }, 1000);
  };

  useEffect(() => () => stopTimer(), []);

  // 提前敲完即胜利
  useEffect(() => {
    if (phase === "typing" && typed.length > 0 && sentence.startsWith(typed) && typed === sentence) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const correct = typed.split("").filter((ch, i) => ch === sentence[i]).length;
  const cpm = Math.round((correct / 30) * 60);
  const accuracy = typed.length ? Math.round((correct / typed.length) * 100) : 0;
  const rating =
    accuracy >= 95 && cpm >= 120 ? "网文触手怪，日更两万不是梦" :
    accuracy >= 95 && cpm >= 80 ? "老键盘侠了，键盘已冒火星" :
    accuracy >= 90 ? "手速尚可，先去冲杯咖啡再战" :
    accuracy >= 70 ? "有点东西，但不多" :
    "别慌，AI 替你码字，你负责摸鱼";

  return (
    <div className="space-y-4">
      {phase === "idle" && (
        <div className="text-center py-6 space-y-4">
          <Keyboard className="w-10 h-10 mx-auto text-amber-500/70" />
          <p className="text-sm text-zinc-400 leading-relaxed max-w-sm mx-auto">
            随机一句网文风台词，<span className="text-zinc-200 font-medium">30 秒</span>内尽力敲完。
            测测你的手速，生成小说的间隙也别闲着。
          </p>
          <Button onClick={start} className="bg-amber-500 text-zinc-950 hover:bg-amber-400 font-semibold active:scale-[0.97] transition-all">
            开始挑战
          </Button>
        </div>
      )}

      {phase === "typing" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-zinc-500 tnum">
            <span className="flex items-center gap-1.5"><Timer className="w-3.5 h-3.5 text-amber-500/70" />剩余 {timeLeft}s</span>
            <span>{typed.length}/{sentence.length} 字</span>
          </div>
          <p className="rounded-xl glass-edge bg-zinc-950/60 px-4 py-3 text-[15px] leading-loose tracking-wide">
            {sentence.split("").map((ch, i) => (
              <span key={i} className={
                i < typed.length
                  ? (ch === typed[i] ? "text-zinc-200" : "text-red-400 bg-red-500/10 rounded-sm")
                  : "text-zinc-600"
              }>{ch}</span>
            ))}
            <span className="inline-block w-[2px] h-[1.1em] bg-amber-400 align-text-bottom animate-pulse" />
          </p>
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value.slice(0, sentence.length))}
            placeholder="照着上面敲，错字会标红…"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          />
        </div>
      )}

      {phase === "result" && (
        <div className="text-center py-4 space-y-4">
          <Trophy className={`w-10 h-10 mx-auto ${accuracy >= 90 ? "text-amber-400" : "text-zinc-600"}`} />
          <div className="flex justify-center gap-8 tnum">
            <div>
              <p className="text-2xl font-bold text-zinc-100">{cpm}</p>
              <p className="text-xs text-zinc-500 mt-1">字 / 分钟</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-zinc-100">{accuracy}%</p>
              <p className="text-xs text-zinc-500 mt-1">正确率</p>
            </div>
          </div>
          <p className="text-sm text-amber-300/90">{rating}</p>
          <Button variant="outline" onClick={start}
            className="border-zinc-800 bg-white/[0.03] hover:bg-white/[0.07] hover:border-amber-500/40 active:scale-[0.97] transition-all">
            <RotateCcw className="w-4 h-4 mr-1" />再来一局
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------- 金句盲盒 ---------- */

function QuoteBox() {
  const [quote, setQuote] = useState<string | null>(null);
  const [drawn, setDrawn] = useState(0);
  return (
    <div className="text-center py-4 space-y-5">
      <div className="min-h-[7rem] flex items-center justify-center px-2">
        {quote ? (
          <p key={drawn} className="text-lg md:text-xl font-medium text-amber-100 leading-relaxed animate-slide-in">
            「{quote}」
          </p>
        ) : (
          <p className="text-sm text-zinc-600">点击按钮，抽一句网文世界的名场面台词</p>
        )}
      </div>
      <Button onClick={() => { setQuote(pick(QUOTES)); setDrawn((n) => n + 1); }}
        className="bg-amber-500 text-zinc-950 hover:bg-amber-400 font-semibold active:scale-[0.97] transition-all">
        <Quote className="w-4 h-4 mr-1" />{quote ? "再抽一句" : "开箱"}
      </Button>
    </div>
  );
}

/* ---------- 剧情骰子 ---------- */

function PlotDice() {
  const [roll, setRoll] = useState<{ s: string; t: string; e: string } | null>(null);
  const [rolling, setRolling] = useState(false);
  const spin = () => {
    setRolling(true);
    // 连掷三次，末次落定，制造骰子滚动的仪式感
    let n = 0;
    const iv = window.setInterval(() => {
      setRoll({ s: pick(SETTINGS), t: pick(TWISTS), e: pick(ENDINGS) });
      if (++n >= 3) { clearInterval(iv); setRolling(false); }
    }, 160);
  };
  const items: { label: string; value?: string }[] = [
    { label: "开局设定", value: roll?.s },
    { label: "神转折", value: roll?.t },
    { label: "结局", value: roll?.e },
  ];
  return (
    <div className="space-y-4 py-2">
      <div className="grid gap-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-xl glass-edge bg-zinc-950/60 px-4 py-3">
            <p className="text-[11px] tracking-[0.25em] text-amber-500/70 uppercase mb-1.5">{it.label}</p>
            <p className={`text-sm leading-relaxed transition-opacity duration-200 ${it.value ? "text-zinc-200" : "text-zinc-700"} ${rolling ? "opacity-60" : "opacity-100"}`}>
              {it.value ?? "待掷出…"}
            </p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-600 flex items-center gap-1.5">
          <Lightbulb className="w-3.5 h-3.5 text-amber-500/60 shrink-0" />
          掷到好梗，可以直接拿去当新书的灵感
        </p>
        <Button onClick={spin} disabled={rolling}
          className="bg-amber-500 text-zinc-950 hover:bg-amber-400 font-semibold active:scale-[0.97] transition-all shrink-0 disabled:opacity-70">
          <Dices className={`w-4 h-4 mr-1 ${rolling ? "animate-spin" : ""}`} />掷一把
        </Button>
      </div>
    </div>
  );
}

/* ---------- 悬浮坞 ---------- */

export default function PastimeDock() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="摸鱼一下"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full border border-amber-500/30 bg-zinc-900/90 backdrop-blur-xl px-4 py-2.5 text-sm font-medium text-amber-200 shadow-[0_8px_30px_rgba(245,158,11,0.15)] transition-all duration-300 ease-fluid hover:border-amber-400/60 hover:shadow-[0_8px_36px_rgba(245,158,11,0.3)] hover:-translate-y-0.5 active:scale-[0.96]"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
        </span>
        <Gamepad2 className="w-4 h-4" />
        摸鱼一下
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gamepad2 className="w-5 h-5 text-amber-400" />摸鱼一下
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              生成还要一会儿，先玩点什么。三个小游戏全部本地运行，不消耗任何额度。
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="type">
            <TabsList className="grid w-full grid-cols-3 bg-zinc-950/70 border border-zinc-800">
              <TabsTrigger value="type" className="data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-200 text-zinc-400">
                <Keyboard className="w-3.5 h-3.5 mr-1.5" />码字挑战
              </TabsTrigger>
              <TabsTrigger value="quote" className="data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-200 text-zinc-400">
                <Quote className="w-3.5 h-3.5 mr-1.5" />金句盲盒
              </TabsTrigger>
              <TabsTrigger value="dice" className="data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-200 text-zinc-400">
                <Dices className="w-3.5 h-3.5 mr-1.5" />剧情骰子
              </TabsTrigger>
            </TabsList>
            <TabsContent value="type" className="mt-4"><TypeChallenge /></TabsContent>
            <TabsContent value="quote" className="mt-4"><QuoteBox /></TabsContent>
            <TabsContent value="dice" className="mt-4"><PlotDice /></TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
