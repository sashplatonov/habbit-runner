package com.sashplatonov.habbit.runner.auth.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.sashplatonov.habbit.runner.auth.dto.DashboardPreferences;
import com.sashplatonov.habbit.runner.auth.dto.DashboardWorkspacePreferences;
import com.sashplatonov.habbit.runner.auth.dto.ThemeUsage;
import com.sashplatonov.habbit.runner.auth.dto.UserWorkspacePreferences;
import com.sashplatonov.habbit.runner.auth.support.ThemeId;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.ArrayList;
import java.util.Comparator;

@ApplicationScoped
public class WorkspacePreferencesCodec {
  private final ObjectMapper objectMapper;

  public WorkspacePreferencesCodec() {
    objectMapper = new ObjectMapper();
  }

  public UserWorkspacePreferences read(String value) {
    try {
      var root = objectMapper.readTree(value == null || value.isBlank() ? "{}" : value);
      validate(root);
      return objectMapper.treeToValue(root, UserWorkspacePreferences.class);
    } catch (JsonProcessingException exception) {
      throw new IllegalArgumentException("Workspace preferences are malformed", exception);
    }
  }

  private void validate(JsonNode root) {
    if (root.has("version") && root.get("version").asInt() != 1) {
      throw new IllegalArgumentException("Unsupported workspace version");
    }
    var dashboard = root.get("dashboard");
    if (dashboard != null) {
      check(dashboard, "filter", "pending", "all", "done", "archived");
      check(dashboard, "sort", "custom", "smart");
      check(dashboard, "density", "comfortable", "compact");
    }
    var progress = root.get("progress");
    if (progress != null) {
      check(progress, "period", "1w", "4w", "12w");
    }
    var navigation = root.get("navigation");
    if (navigation != null) {
      check(navigation, "screen", "dashboard", "progress", "account", "habit-detail");
    }
    var usage = root.get("themeUsage");
    if (usage != null && usage.isArray()) {
      for (var entry : usage) {
        check(entry, "theme", "cloud", "peach", "mint", "lavender", "paper", "midnight",
            "graphite", "ember", "violet", "matrix", "arctic", "aurora", "dune", "lagoon", "sakura");
      }
    }
  }

  private void check(JsonNode object, String field, String... allowed) {
    if (!object.has(field) || object.get(field).isNull()) {
      return;
    }
    var value = object.get(field).asText();
    for (var candidate : allowed) {
      if (candidate.equals(value)) {
        return;
      }
    }
    throw new IllegalArgumentException("Unsupported workspace value: " + field);
  }

  public UserWorkspacePreferences readOrDefaults(String value) {
    try {
      return read(value);
    } catch (IllegalArgumentException exception) {
      return new UserWorkspacePreferences();
    }
  }

  public String write(UserWorkspacePreferences value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException exception) {
      throw new IllegalArgumentException("Workspace preferences could not be serialized", exception);
    }
  }

  public UserWorkspacePreferences fromLegacy(DashboardPreferences legacy) {
    var dashboard = legacy == null ? new DashboardPreferences() : legacy;
    var usage = new ArrayList<ThemeUsage>();
    if (dashboard.themeUsage() != null) {
      dashboard.themeUsage().forEach((theme, count) -> {
        try {
          usage.add(new ThemeUsage(ThemeId.fromWireValue(theme), count));
        } catch (RuntimeException ignored) {
          // Invalid legacy theme usage is discarded during migration.
        }
      });
    }
    usage.sort(Comparator.comparing(ThemeUsage::count).reversed());
    return new UserWorkspacePreferences(
        1,
        new DashboardWorkspacePreferences(
            com.sashplatonov.habbit.runner.auth.dto.DashboardFilter.fromWireValue(dashboard.filter()),
            "",
            dashboard.tags(),
            com.sashplatonov.habbit.runner.auth.dto.DashboardSort.fromWireValue(dashboard.sort()),
            com.sashplatonov.habbit.runner.auth.dto.DashboardDensity.fromWireValue(dashboard.density())
        ),
        null,
        null,
        usage
    );
  }
}
