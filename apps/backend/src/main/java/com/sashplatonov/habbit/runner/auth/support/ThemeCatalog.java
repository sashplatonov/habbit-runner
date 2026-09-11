package com.sashplatonov.habbit.runner.auth.support;

import java.util.Set;
import java.util.Arrays;

public final class ThemeCatalog {
  private static final String DEFAULT_THEME = ThemeId.CLOUD.wireValue();
  private static final Set<String> THEME_IDS = Set.copyOf(
      Arrays.stream(ThemeId.values()).map(ThemeId::wireValue).toList());

  private ThemeCatalog() {
  }

  public static String normalize(String value) {
    return value != null && THEME_IDS.contains(value) ? value : DEFAULT_THEME;
  }
}
