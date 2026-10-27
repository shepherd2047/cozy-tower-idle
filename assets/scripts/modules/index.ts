// Every feature module file, imported once for its registerModule() side effect (see ../GameModule.ts).
// One line per module; each feature session appends its own line, e.g.  import './Alchemy';
export {};
import './siege';   // first: temple / sorcery hook into siege.onDamage at init
import './embassy';
import './dragons';
import './sorcery';
import './temple';
import './observatory';
import './obelisk';
import './buildings';
import './academy';
import './alchemy';
import './runes';
import './prestige';
