import {
  Activity,
  Brain,
  Briefcase,
  Compass,
  Flame,
  Heart,
  type LucideIcon,
  Sparkles,
  Tag,
  Target,
  Users,
  Wallet,
} from 'lucide-react';

/** One icon per life-area (44/57) — shared by the overview tiles + the InsightCard fact-group headers. */
export const LIFE_AREA_ICON: Record<string, LucideIcon> = {
  Relationships: Heart,
  Family: Users,
  'Work & purpose': Briefcase,
  'Health & body': Activity,
  'Emotions & patterns': Brain,
  'Values & beliefs': Compass,
  Intimacy: Flame,
  'Goals & growth': Target,
  Money: Wallet,
  Faith: Sparkles,
  Other: Tag,
};

export const areaIcon = (area: string): LucideIcon => LIFE_AREA_ICON[area] ?? Tag;
