package com.sashplatonov.habbit.runner.auth.dto;

import com.sashplatonov.habbit.runner.auth.support.ThemeId;

public record ThemeUsage(ThemeId theme, Integer count) {
  public ThemeUsage {
    theme = theme == null ? ThemeId.CLOUD : theme;
    count = count == null || count < 0 ? 0 : Math.min(count, 1_000_000);
  }
}
