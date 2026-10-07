using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AgentCapabilities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AgentType",
                table: "PromptPresets",
                type: "TEXT",
                maxLength: 20,
                nullable: false,
                defaultValue: "General");

            migrationBuilder.AddColumn<Guid>(
                name: "ModelId",
                table: "PromptPresets",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReasoningEffort",
                table: "PromptPresets",
                type: "TEXT",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SkillIds",
                table: "PromptPresets",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SubAgentIds",
                table: "PromptPresets",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AgentType",
                table: "PromptPresets");

            migrationBuilder.DropColumn(
                name: "ModelId",
                table: "PromptPresets");

            migrationBuilder.DropColumn(
                name: "ReasoningEffort",
                table: "PromptPresets");

            migrationBuilder.DropColumn(
                name: "SkillIds",
                table: "PromptPresets");

            migrationBuilder.DropColumn(
                name: "SubAgentIds",
                table: "PromptPresets");
        }
    }
}
