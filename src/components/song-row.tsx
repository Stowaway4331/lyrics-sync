import { ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

export function SongRow({
  title,
  subtitle,
  badge,
  disabled,
  onPress,
  className,
}: {
  title: string;
  subtitle: string;
  badge?: { label: string; variant?: 'default' | 'secondary' | 'outline' } | null;
  disabled?: boolean;
  onPress?: () => void;
  className?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      className={cn('min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-accent', disabled && 'opacity-50', className)}>
      <View className="flex-1 gap-0.5">
        <Text className="font-medium" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {badge && (
        <Badge variant={badge.variant ?? 'secondary'}>
          <Text>{badge.label}</Text>
        </Badge>
      )}
      {onPress && !disabled && <Icon as={ChevronRight} size={16} className="text-muted-foreground" />}
    </Pressable>
  );
}
