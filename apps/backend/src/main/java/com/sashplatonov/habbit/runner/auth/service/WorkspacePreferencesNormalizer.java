package com.sashplatonov.habbit.runner.auth.service;

import com.sashplatonov.habbit.runner.auth.dto.DashboardWorkspacePreferences;
import com.sashplatonov.habbit.runner.auth.dto.ThemeUsage;
import com.sashplatonov.habbit.runner.auth.dto.UserWorkspacePreferences;
import com.sashplatonov.habbit.runner.auth.dto.WorkspaceNavigation;
import java.util.ArrayList;
import java.util.UUID;

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
    var tags = dashboard.tags().stream()
        .filter(tag -> tag != null && !tag.isBlank() && tag.trim().length() <= MAX_TAG_LENGTH)
        .map(String::trim).distinct().limit(MAX_TAGS).toList();
    var search = dashboard.searchQuery() == null ? "" : dashboard.searchQuery().trim();
    if (search.length() > MAX_SEARCH_LENGTH) {
      search = search.substring(0, MAX_SEARCH_LENGTH);
    }
    var navigation = source.navigation();
    if (navigation.screen().name().equals("HABIT_DETAIL")
        && (navigation.selectedHabitId() == null || !isUuid(navigation.selectedHabitId()))) {
      navigation = new WorkspaceNavigation();
    } else if (!navigation.screen().name().equals("HABIT_DETAIL")) {
      navigation = new WorkspaceNavigation(navigation.screen(), null);
    }
    var usage = new ArrayList<ThemeUsage>();
    for (var entry : source.themeUsage()) {
      if (entry == null || entry.theme() == null || usage.stream().anyMatch(item -> item.theme() == entry.theme())) {
        continue;
      }
      usage.add(new ThemeUsage(entry.theme(), entry.count()));
      if (usage.size() == MAX_USAGE) {
        break;
      }
    }
    return new UserWorkspacePreferences(
        1,
        new DashboardWorkspacePreferences(
            dashboard.filter(), search, tags, dashboard.sort(), dashboard.density()),
        source.progress(), navigation, usage);
  }

  public static UserWorkspacePreferences defaults() {
    return new UserWorkspacePreferences();
  }

  private static boolean isUuid(String value) {
    try {
      UUID.fromString(value);
      return true;
    } catch (IllegalArgumentException exception) {
      return false;
    }
  }
}
