package com.sashplatonov.habbit.runner.auth.service;

import com.sashplatonov.habbit.runner.auth.dto.DashboardWorkspacePreferences;
import com.sashplatonov.habbit.runner.auth.dto.ThemeUsage;
import com.sashplatonov.habbit.runner.auth.dto.UserWorkspacePreferences;
import com.sashplatonov.habbit.runner.auth.dto.WorkspaceNavigation;
import java.util.ArrayList;
import java.util.List;

public final class WorkspacePreferencesNormalizer {
  private static final int MAX_SEARCH_LENGTH = 200;
  private static final int MAX_TAGS = 50;
  private static final int MAX_TAG_LENGTH = 40;
  private static final int MAX_USAGE = 15;

  private WorkspacePreferencesNormalizer() {
  }

  public static UserWorkspacePreferences normalize(UserWorkspacePreferences value) {
    var source = value == null ? new UserWorkspacePreferences() : value;
    var dashboard = source.dashboard();
    var tags = normalizeTags(dashboard.tags());
    var search = normalizeSearch(dashboard.searchQuery());
    var navigation = normalizeNavigation(source.navigation());
    var usage = normalizeThemeUsage(source.themeUsage());
    return new UserWorkspacePreferences(
        1,
        new DashboardWorkspacePreferences(
            dashboard.filter(), search, tags, dashboard.sort(), dashboard.density()),
        source.progress(), navigation, usage);
  }

  private static List<String> normalizeTags(List<String> tags) {
    return tags.stream()
        .filter(WorkspacePreferencesNormalizer::isValidTag)
        .map(String::trim).distinct().limit(MAX_TAGS).toList();
  }

  private static boolean isValidTag(String tag) {
    return tag != null && !tag.isBlank() && tag.trim().length() <= MAX_TAG_LENGTH;
  }

  private static String normalizeSearch(String searchQuery) {
    var search = searchQuery == null ? "" : searchQuery.trim();
    return search.length() > MAX_SEARCH_LENGTH ? search.substring(0, MAX_SEARCH_LENGTH) : search;
  }

  private static WorkspaceNavigation normalizeNavigation(WorkspaceNavigation navigation) {
    if (navigation.screen().name().equals("HABIT_DETAIL") && isMissingHabitId(navigation)) {
      return new WorkspaceNavigation();
    }
    return navigation.screen().name().equals("HABIT_DETAIL") ? navigation
        : new WorkspaceNavigation(navigation.screen(), null);
  }

  private static boolean isMissingHabitId(WorkspaceNavigation navigation) {
    return navigation.selectedHabitId() == null || navigation.selectedHabitId().isBlank();
  }

  private static List<ThemeUsage> normalizeThemeUsage(List<ThemeUsage> themeUsage) {
    List<ThemeUsage> usage = new ArrayList<>();
    for (var entry : themeUsage) {
      addUniqueThemeUsage(usage, entry);
    }
    return usage;
  }

  private static void addUniqueThemeUsage(List<ThemeUsage> usage, ThemeUsage entry) {
    if (entry != null && entry.theme() != null && !containsTheme(usage, entry) && usage.size() < MAX_USAGE) {
      usage.add(new ThemeUsage(entry.theme(), entry.count()));
    }
  }

  private static boolean containsTheme(List<ThemeUsage> usage, ThemeUsage entry) {
    return usage.stream().anyMatch(item -> item.theme() == entry.theme());
  }

  public static UserWorkspacePreferences defaults() {
    return new UserWorkspacePreferences();
  }

}
