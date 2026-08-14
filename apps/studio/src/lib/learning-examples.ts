import {
  literal,
  type ElementNode,
  type UiDocument,
  type ValueExpression,
  type ValueShape,
} from '@srijika/contracts';

import { ref, spacing, TemplateBuilder } from './templates';

export type LearningExampleCategory = 'Props' | 'Loops' | 'Conditions' | 'Expressions' | 'Events';

export interface LearningExample {
  id: string;
  name: string;
  description: string;
  category: LearningExampleCategory;
  accent: string;
  concepts: readonly string[];
  syntax: readonly string[];
  createDocument: (pageId?: string) => UiDocument;
}

interface LessonShell {
  builder: TemplateBuilder;
  stage: ElementNode;
}

const objectShape = (fields: Readonly<Record<string, ValueShape>>): ValueShape => ({
  kind: 'object',
  fields: Object.fromEntries(
    Object.entries(fields).map(([name, shape]) => [name, { required: true, shape }]),
  ),
  additionalProperties: false,
});

const arrayShape = (item: ValueShape): ValueShape => ({ kind: 'array', item });

const styleShape = objectShape({
  backgroundColor: { kind: 'color' },
  color: { kind: 'color' },
  borderColor: { kind: 'color' },
  borderWidth: { kind: 'number' },
  borderRadius: { kind: 'number' },
  boxShadow: { kind: 'string' },
});

const themeShape = objectShape({
  cardStyle: styleShape,
  accentStyle: styleShape,
});

const listItemShape = objectShape({
  id: { kind: 'string' },
  name: { kind: 'string' },
  detail: { kind: 'string' },
});

const nestedGroupShape = objectShape({
  id: { kind: 'string' },
  name: { kind: 'string' },
  items: arrayShape(listItemShape),
});

const nestedDataShape = objectShape({
  groups: arrayShape(nestedGroupShape),
});

const template = (...parts: Array<string | ValueExpression>): ValueExpression => ({
  kind: 'template',
  parts,
});

const bindStyle = (node: ElementNode, value: ValueExpression): void => {
  node.props['style'] = value;
};

const codeStyle = {
  width: { mode: 'hug' as const },
  padding: spacing(6, 9),
  borderColor: '#30435f',
  borderWidth: 1,
  borderRadius: 7,
  backgroundColor: '#091525',
  color: '#b6c8e3',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 11,
  lineHeight: 1.45,
};

function addSyntaxChip(
  builder: TemplateBuilder,
  parentId: string,
  id: string,
  label: string,
): void {
  builder.text(parentId, id, `${label} syntax`, label, codeStyle);
}

function createLessonShell(
  pageId: string,
  name: string,
  category: LearningExampleCategory,
  description: string,
  syntax: readonly string[],
  accent: string,
): LessonShell {
  const builder = new TemplateBuilder(pageId, name, {
    minHeight: 820,
    padding: spacing(36),
    gap: 22,
    backgroundColor: '#07111f',
    color: '#e8eef8',
    overflow: 'auto',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  });

  builder.stack('root', 'lesson_header', 'Lesson Header', { gap: 9 });
  builder.text(
    'lesson_header',
    'lesson_category',
    'Lesson Category',
    `LEARN / ${category.toUpperCase()} / ONE CONCEPT`,
    {
      color: accent,
      fontSize: 11,
      fontWeight: 800,
      letterSpacing: 1,
    },
  );
  builder.heading('lesson_header', 'lesson_title', 'Lesson Name', name, 1, {
    maxWidth: 820,
    color: '#f7f9ff',
    fontSize: 38,
    fontWeight: 800,
    lineHeight: 1.08,
  });
  builder.text('lesson_header', 'lesson_description', 'Lesson Explanation', description, {
    maxWidth: 780,
    color: '#9eb0c8',
    fontSize: 15,
    lineHeight: 1.55,
  });
  builder.stack('lesson_header', 'lesson_syntax', 'Exact React Syntax', {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  });
  syntax.forEach((label, index) =>
    addSyntaxChip(builder, 'lesson_syntax', `lesson_syntax_${index}`, label),
  );

  const stage = builder.container('root', 'lesson_stage', `${name} Live Component`, {
    minHeight: 290,
    padding: spacing(24),
    gap: 16,
    borderColor: '#29415f',
    borderWidth: 1,
    borderRadius: 20,
    backgroundColor: '#0e1b2d',
    color: '#e8eef8',
    boxShadow: '0 18px 55px rgba(0, 0, 0, 0.2)',
  });
  builder.text(stage.id, 'lesson_live_label', 'Live Component Label', 'LIVE COMPONENT', {
    color: accent,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 1,
  });

  return { builder, stage };
}

function finishLesson(builder: TemplateBuilder, instruction: string): UiDocument {
  builder.container('root', 'lesson_try', 'Try This Instruction', {
    padding: spacing(15, 18),
    gap: 5,
    borderColor: '#2d4160',
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: '#091525',
  });
  builder.text('lesson_try', 'lesson_try_label', 'Try This Label', 'TRY IT IN SRIJIKA', {
    color: '#9e8cff',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 0.8,
  });
  builder.text('lesson_try', 'lesson_try_copy', 'Try This Explanation', instruction, {
    color: '#aebed4',
    fontSize: 12,
    lineHeight: 1.5,
  });

  builder.responsive('root', {
    tablet: { padding: spacing(24), gap: 18 },
    mobile: { minHeight: 0, padding: spacing(16), gap: 14 },
  });
  builder.responsive('lesson_title', { mobile: { fontSize: 29, overflowWrap: 'anywhere' } });
  builder.responsive('lesson_stage', {
    mobile: { minHeight: 0, padding: spacing(17), gap: 13 },
  });
  return builder.document;
}

function createPropsValuesLesson(pageId = 'example_props_values'): UiDocument {
  const { builder, stage } = createLessonShell(
    pageId,
    'Text & Numbers from Props',
    'Props',
    'Bind declared string and number props directly to visible component content.',
    ['props.headline', 'Members: {props.memberCount}'],
    '#8ee8c4',
  );
  const headline = builder.publicValue('headline', 'string', 'Workspace overview', {
    kind: 'string',
  });
  const memberCount = builder.publicValue('memberCount', 'number', 24, { kind: 'number' });
  const statusLabel = builder.publicValue('statusLabel', 'string', 'Active workspace', {
    kind: 'string',
  });

  builder.heading(
    stage.id,
    'props_value_heading',
    'Headline from props.headline',
    ref(headline),
    2,
    {
      color: '#f7f9ff',
      fontSize: 28,
      fontWeight: 760,
    },
  );
  builder.stack(stage.id, 'props_value_row', 'Prop Value Result Row', {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  });
  builder.text(
    'props_value_row',
    'props_member_count',
    'Number from props.memberCount',
    template('Members: ', ref(memberCount)),
    { color: '#b7c7dc', fontSize: 15, fontWeight: 650 },
  );
  builder.badge(
    'props_value_row',
    'props_status_badge',
    'Label from props.statusLabel',
    ref(statusLabel),
    'success',
  );

  return finishLesson(
    builder,
    'Select the Page, open Props, then change headline, memberCount, or statusLabel.',
  );
}

function createPropsStyleLesson(pageId = 'example_props_style'): UiDocument {
  const { builder, stage } = createLessonShell(
    pageId,
    'Colors & Style from Props',
    'Props',
    'Pass validated style objects through props and let srijikaStyle safely merge them.',
    ['srijikaStyle(props.theme.cardStyle)', 'srijikaStyle(props.theme.accentStyle)'],
    '#7c6cff',
  );
  const title = builder.publicValue('title', 'string', 'A prop-styled component', {
    kind: 'string',
  });
  const theme = builder.publicValue(
    'theme',
    'object',
    {
      cardStyle: {
        backgroundColor: '#13243a',
        color: '#f3f7ff',
        borderColor: '#576f9a',
        borderWidth: 1,
        borderRadius: 20,
        boxShadow: '0 18px 44px rgba(0, 0, 0, 0.24)',
      },
      accentStyle: {
        backgroundColor: '#755cff',
        color: '#ffffff',
        borderColor: '#9f91ff',
        borderWidth: 1,
        borderRadius: 10,
        boxShadow: '0 10px 24px rgba(117, 92, 255, 0.28)',
      },
    },
    themeShape,
  );

  bindStyle(stage, ref(theme, ['cardStyle']));
  builder.heading(stage.id, 'style_title', 'Title inside prop-styled card', ref(title), 2, {
    fontSize: 28,
    fontWeight: 760,
  });
  builder.text(
    stage.id,
    'style_copy',
    'Dynamic Style Explanation',
    'The card and button below receive complete style objects from props.theme.',
    { maxWidth: 620, fontSize: 14, lineHeight: 1.55 },
  );
  const accentButton = builder.button(
    stage.id,
    'style_accent_button',
    'Button styled by props.theme.accentStyle',
    'Prop-styled button',
    'primary',
    { width: { mode: 'hug' }, minHeight: 42, padding: spacing(9, 14) },
  );
  bindStyle(accentButton, ref(theme, ['accentStyle']));

  return finishLesson(
    builder,
    'Open Props, edit the theme JSON colors, apply it, and watch only this component change.',
  );
}

function createArrayLoopLesson(pageId = 'example_array_loop'): UiDocument {
  const { builder, stage } = createLessonShell(
    pageId,
    'Array Loop (.map)',
    'Loops',
    'One Repeat node renders one small component for every object in an array prop.',
    ['props.items.map((item, index) => ...)'],
    '#73d7ff',
  );
  const items = builder.publicValue(
    'items',
    'array',
    [
      { id: 'design', name: 'Design system', detail: '12 components' },
      { id: 'desktop', name: 'Desktop shell', detail: 'Ready to preview' },
      { id: 'connector', name: 'Logic connector', detail: 'Typed props only' },
    ],
    arrayShape(listItemShape),
  );

  builder.stack(stage.id, 'array_loop_list', 'Array Items List', { gap: 9 });
  const repeat = builder.repeat(
    'array_loop_list',
    'array_item_repeat',
    'Items Array Repeat',
    ref(items),
    listItemShape,
  );
  builder.stack(repeat.id, 'array_item_card', 'Repeated Item Component', {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    padding: spacing(12),
    borderColor: '#263e5b',
    borderWidth: 1,
    borderRadius: 11,
    backgroundColor: '#091727',
  });
  builder.heading(
    'array_item_card',
    'array_item_name',
    'Repeated Item Name',
    ref(repeat.itemSymbolId, ['name']),
    3,
    { color: '#f5f8ff', fontSize: 15, fontWeight: 720, flexGrow: 1 },
  );
  builder.text(
    'array_item_card',
    'array_item_detail',
    'Repeated Item Detail',
    ref(repeat.itemSymbolId, ['detail']),
    { color: '#93a8c4', fontSize: 12 },
  );

  return finishLesson(
    builder,
    'Edit the items JSON in Page Props. Add or remove one object and the repeated rows update.',
  );
}

function createNestedLoopLesson(pageId = 'example_nested_repeat'): UiDocument {
  const { builder, stage } = createLessonShell(
    pageId,
    'Nested Object + Array Loop',
    'Loops',
    'Read groups from an object prop, then loop through the items array inside every group.',
    ['props.guideData.groups.map(...)', 'group.items.map(...)'],
    '#4cc9f0',
  );
  const guideData = builder.publicValue(
    'guideData',
    'object',
    {
      groups: [
        {
          id: 'design',
          name: 'Design',
          items: [
            { id: 'maya', name: 'Maya Chen', detail: 'Product designer' },
            { id: 'noah', name: 'Noah Kim', detail: 'Design systems' },
          ],
        },
        {
          id: 'engineering',
          name: 'Engineering',
          items: [
            { id: 'ava', name: 'Ava Singh', detail: 'Frontend engineer' },
            { id: 'leo', name: 'Leo Martin', detail: 'Rust engineer' },
          ],
        },
      ],
    },
    nestedDataShape,
  );

  builder.grid(stage.id, 'nested_group_grid', 'Nested Group Grid', 2, {
    gap: 12,
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  });
  const groupRepeat = builder.repeat(
    'nested_group_grid',
    'nested_group_repeat',
    'Groups Repeat',
    ref(guideData, ['groups']),
    nestedGroupShape,
  );
  builder.container(groupRepeat.id, 'nested_group_card', 'Repeated Group Component', {
    padding: spacing(14),
    gap: 10,
    borderColor: '#28405d',
    borderWidth: 1,
    borderRadius: 13,
    backgroundColor: '#091727',
  });
  builder.heading(
    'nested_group_card',
    'nested_group_name',
    'Current Group Name',
    ref(groupRepeat.itemSymbolId, ['name']),
    3,
    { color: '#f5f8ff', fontSize: 17, fontWeight: 730 },
  );
  builder.stack('nested_group_card', 'nested_item_list', 'Current Group Items', { gap: 7 });
  const itemRepeat = builder.repeat(
    'nested_item_list',
    'nested_item_repeat',
    'Nested Items Repeat',
    ref(groupRepeat.itemSymbolId, ['items']),
    listItemShape,
  );
  builder.stack(itemRepeat.id, 'nested_item_row', 'Nested Repeated Item', {
    gap: 2,
    padding: spacing(9, 10),
    borderRadius: 9,
    backgroundColor: '#102036',
  });
  builder.heading(
    'nested_item_row',
    'nested_item_name',
    'Nested Item Name',
    ref(itemRepeat.itemSymbolId, ['name']),
    4,
    { color: '#eaf1fb', fontSize: 13, fontWeight: 700 },
  );
  builder.text(
    'nested_item_row',
    'nested_item_detail',
    'Nested Item Detail',
    ref(itemRepeat.itemSymbolId, ['detail']),
    { color: '#8fa5c0', fontSize: 11 },
  );
  builder.responsive('nested_group_grid', {
    mobile: { gridTemplateColumns: 'minmax(0, 1fr)' },
  });

  return finishLesson(
    builder,
    'Open Props and inspect guideData: object → groups array → each group items array.',
  );
}

function createIfElseLesson(pageId = 'example_if_else'): UiDocument {
  const { builder, stage } = createLessonShell(
    pageId,
    'If / Else Branches',
    'Conditions',
    'A boolean prop chooses exactly one of two complete component branches.',
    ['isSignedIn ? <Welcome /> : <SignIn />'],
    '#ffb86b',
  );
  const isSignedIn = builder.publicValue('isSignedIn', 'boolean', true, { kind: 'boolean' });
  const displayName = builder.publicValue('displayName', 'string', 'Alex', { kind: 'string' });
  const condition = builder.condition(
    stage.id,
    'if_else_condition',
    'Signed In If Else',
    ref(isSignedIn),
  );
  builder.container(
    condition,
    'if_true_branch',
    'Signed In True Branch',
    {
      padding: spacing(18),
      gap: 6,
      borderColor: '#2f6a5a',
      borderWidth: 1,
      borderRadius: 13,
      backgroundColor: '#0c2a24',
    },
    'div',
    'whenTrue',
  );
  builder.heading(
    'if_true_branch',
    'if_true_title',
    'True Branch Greeting',
    template('Welcome, ', ref(displayName)),
    2,
    { color: '#dfffee', fontSize: 24, fontWeight: 760 },
  );
  builder.text(
    'if_true_branch',
    'if_true_copy',
    'True Branch Explanation',
    'This entire component is the true branch.',
    { color: '#91cbb7', fontSize: 13 },
  );
  builder.container(
    condition,
    'if_false_branch',
    'Signed Out False Branch',
    {
      padding: spacing(18),
      gap: 6,
      borderColor: '#724545',
      borderWidth: 1,
      borderRadius: 13,
      backgroundColor: '#2b171a',
    },
    'div',
    'whenFalse',
  );
  builder.heading(
    'if_false_branch',
    'if_false_title',
    'False Branch Heading',
    'Please sign in',
    2,
    {
      color: '#ffe6e6',
      fontSize: 24,
      fontWeight: 760,
    },
  );
  builder.text(
    'if_false_branch',
    'if_false_copy',
    'False Branch Explanation',
    'Set props.isSignedIn to false to render this component instead.',
    { color: '#d7a3a3', fontSize: 13 },
  );

  return finishLesson(
    builder,
    'Toggle isSignedIn in Page Props and watch the two branches switch.',
  );
}

function createLogicalAndLesson(pageId = 'example_logical_and'): UiDocument {
  const { builder, stage } = createLessonShell(
    pageId,
    'Logical AND (&&)',
    'Conditions',
    'Render one component only when both boolean props are true.',
    ['isSignedIn && hasNotifications'],
    '#46d8e8',
  );
  const isSignedIn = builder.publicValue('isSignedIn', 'boolean', true, { kind: 'boolean' });
  const hasNotifications = builder.publicValue('hasNotifications', 'boolean', true, {
    kind: 'boolean',
  });
  builder.text(
    stage.id,
    'and_rule',
    'AND Rule Explanation',
    'Both switches must be true. If either one is false, the result component disappears.',
    { color: '#9db1ca', fontSize: 13, lineHeight: 1.5 },
  );
  const condition = builder.condition(stage.id, 'logical_and_condition', 'Logical AND Condition', {
    kind: 'binary',
    operator: 'and',
    left: ref(isSignedIn),
    right: ref(hasNotifications),
  });
  builder.container(
    condition,
    'logical_and_result',
    'AND True Result Component',
    {
      width: { mode: 'hug' },
      padding: spacing(15),
      borderColor: '#248f91',
      borderWidth: 1,
      borderRadius: 12,
      backgroundColor: '#0d3036',
    },
    'div',
    'whenTrue',
  );
  builder.badge(
    'logical_and_result',
    'logical_and_badge',
    'AND Result Badge',
    'Signed in AND has notifications',
    'info',
  );

  return finishLesson(
    builder,
    'Toggle isSignedIn or hasNotifications. The result exists only for true && true.',
  );
}

function createLogicalOrLesson(pageId = 'example_logical_or'): UiDocument {
  const { builder, stage } = createLessonShell(
    pageId,
    'Logical OR (||)',
    'Conditions',
    'Render one component when at least one of two boolean props is true.',
    ['isOwner || isAdmin'],
    '#79e6aa',
  );
  const isOwner = builder.publicValue('isOwner', 'boolean', false, { kind: 'boolean' });
  const isAdmin = builder.publicValue('isAdmin', 'boolean', true, { kind: 'boolean' });
  builder.text(
    stage.id,
    'or_rule',
    'OR Rule Explanation',
    'Only false + false hides the result. Any true value grants access.',
    { color: '#9db1ca', fontSize: 13, lineHeight: 1.5 },
  );
  const condition = builder.condition(stage.id, 'logical_or_condition', 'Logical OR Condition', {
    kind: 'binary',
    operator: 'or',
    left: ref(isOwner),
    right: ref(isAdmin),
  });
  builder.container(
    condition,
    'logical_or_result',
    'OR True Result Component',
    {
      width: { mode: 'hug' },
      padding: spacing(15),
      borderColor: '#337257',
      borderWidth: 1,
      borderRadius: 12,
      backgroundColor: '#102d22',
    },
    'div',
    'whenTrue',
  );
  builder.badge(
    'logical_or_result',
    'logical_or_badge',
    'OR Result Badge',
    'Edit access granted',
    'success',
  );

  return finishLesson(builder, 'Set both isOwner and isAdmin to false to hide the access result.');
}

function createLogicalNotLesson(pageId = 'example_logical_not'): UiDocument {
  const { builder, stage } = createLessonShell(
    pageId,
    'Logical NOT (!)',
    'Conditions',
    'Invert one boolean prop before deciding whether a component should render.',
    ['!isLoading'],
    '#ffd36b',
  );
  const isLoading = builder.publicValue('isLoading', 'boolean', false, { kind: 'boolean' });
  builder.text(
    stage.id,
    'not_rule',
    'NOT Rule Explanation',
    'The result is visible when isLoading is false because !false becomes true.',
    { color: '#9db1ca', fontSize: 13, lineHeight: 1.5 },
  );
  const condition = builder.condition(stage.id, 'logical_not_condition', 'Logical NOT Condition', {
    kind: 'unary',
    operator: 'not',
    operand: ref(isLoading),
  });
  builder.container(
    condition,
    'logical_not_result',
    'NOT True Result Component',
    {
      width: { mode: 'hug' },
      padding: spacing(15),
      borderColor: '#80682e',
      borderWidth: 1,
      borderRadius: 12,
      backgroundColor: '#302811',
    },
    'div',
    'whenTrue',
  );
  builder.badge(
    'logical_not_result',
    'logical_not_badge',
    'NOT Result Badge',
    'Content is ready',
    'warning',
  );

  return finishLesson(
    builder,
    'Set isLoading to true. The !isLoading result component disappears.',
  );
}

function createTernaryLesson(pageId = 'example_ternary'): UiDocument {
  const { builder, stage } = createLessonShell(
    pageId,
    'Ternary Value (? :)',
    'Expressions',
    'Choose between two values inside one component prop without creating two components.',
    ['isPro ? "PRO PLAN" : "FREE PLAN"'],
    '#c7a7ff',
  );
  const isPro = builder.publicValue('isPro', 'boolean', false, { kind: 'boolean' });
  builder.text(
    stage.id,
    'ternary_rule',
    'Ternary Rule Explanation',
    'The Badge component stays the same; only its label value changes.',
    { color: '#9db1ca', fontSize: 13, lineHeight: 1.5 },
  );
  builder.badge(
    stage.id,
    'ternary_plan_badge',
    'Plan label from ternary expression',
    {
      kind: 'conditional',
      condition: ref(isPro),
      whenTrue: literal('PRO PLAN'),
      whenFalse: literal('FREE PLAN'),
    },
    'primary',
    { width: { mode: 'hug' }, padding: spacing(8, 12), fontSize: 13 },
  );

  return finishLesson(
    builder,
    'Toggle isPro. The same Badge changes between FREE PLAN and PRO PLAN.',
  );
}

function createNullishFallbackLesson(pageId = 'example_nullish_fallback'): UiDocument {
  const { builder, stage } = createLessonShell(
    pageId,
    'Default Fallback (??)',
    'Expressions',
    'An optional typed prop carries a design default that generated JSX uses as a nullish fallback.',
    ['props.headline ?? "Default headline"'],
    '#e6a8ff',
  );
  const headline = builder.publicValue('headline', 'string', 'Default headline', {
    kind: 'string',
  });
  builder.heading(
    stage.id,
    'nullish_headline',
    'Headline with generated nullish fallback',
    ref(headline),
    2,
    { color: '#f7f3ff', fontSize: 28, fontWeight: 760 },
  );
  builder.text(
    stage.id,
    'nullish_rule',
    'Nullish Fallback Explanation',
    'Srijika keeps the typed default on the optional page prop. Open JSX to see ?? emitted automatically.',
    { maxWidth: 650, color: '#b5a6c7', fontSize: 13, lineHeight: 1.55 },
  );

  return finishLesson(
    builder,
    'Change headline in Props, then open JSX and find the generated props.headline ?? fallback.',
  );
}

function createTypedEventLesson(pageId = 'example_typed_event'): UiDocument {
  const { builder, stage } = createLessonShell(
    pageId,
    'Typed Event Argument',
    'Events',
    'A button inside Repeat extracts item.id and passes only that typed string to a page event.',
    ['props.onSelectItem?.(item.id)'],
    '#ff8f9c',
  );
  const items = builder.publicValue(
    'items',
    'array',
    [
      { id: 'maya', name: 'Maya Chen', detail: 'Product designer' },
      { id: 'ava', name: 'Ava Singh', detail: 'Frontend engineer' },
    ],
    arrayShape(listItemShape),
  );
  const onSelectItem = builder.publicEvent('onSelectItem', {
    payload: { name: 'itemId', shape: { kind: 'string' } },
  });
  builder.stack(stage.id, 'event_item_list', 'Event Example Items', { gap: 9 });
  const repeat = builder.repeat(
    'event_item_list',
    'event_item_repeat',
    'Event Items Repeat',
    ref(items),
    listItemShape,
  );
  builder.stack(repeat.id, 'event_item_row', 'Repeated Event Item', {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    padding: spacing(11),
    borderColor: '#4e3340',
    borderWidth: 1,
    borderRadius: 11,
    backgroundColor: '#24151d',
  });
  builder.stack('event_item_row', 'event_item_copy', 'Event Item Copy', {
    minWidth: 0,
    flexGrow: 1,
    gap: 2,
  });
  builder.heading(
    'event_item_copy',
    'event_item_name',
    'Event Item Name',
    ref(repeat.itemSymbolId, ['name']),
    3,
    { color: '#fff1f3', fontSize: 14, fontWeight: 720 },
  );
  builder.text(
    'event_item_copy',
    'event_item_detail',
    'Event Item Detail',
    ref(repeat.itemSymbolId, ['detail']),
    { color: '#c9a4ad', fontSize: 11 },
  );
  const selectButton = builder.button(
    'event_item_row',
    'event_select_button',
    'Select Item with Typed Argument',
    'Select item',
    'primary',
    { width: { mode: 'hug' }, minHeight: 34, padding: spacing(6, 10), fontSize: 11 },
  );
  builder.bindClick(selectButton, onSelectItem, ref(repeat.itemSymbolId, ['id']));

  return finishLesson(
    builder,
    'Open Events to inspect itemId: string, then select the button and inspect its argument mapping.',
  );
}

export const studioLearningExamples: readonly LearningExample[] = [
  {
    id: 'props-values',
    name: 'Text & Numbers from Props',
    description: 'Bind declared string and number props directly to visible content.',
    category: 'Props',
    accent: '#8ee8c4',
    concepts: ['String prop binding', 'Number inside template text'],
    syntax: ['props.headline', 'props.memberCount'],
    createDocument: createPropsValuesLesson,
  },
  {
    id: 'props-style',
    name: 'Colors & Style from Props',
    description: 'Change a card and button through validated style-object props.',
    category: 'Props',
    accent: '#7c6cff',
    concepts: ['Typed object style prop', 'Safe srijikaStyle merge'],
    syntax: ['srijikaStyle(props.theme.cardStyle)'],
    createDocument: createPropsStyleLesson,
  },
  {
    id: 'array-loop',
    name: 'Array Loop (.map)',
    description: 'Render one small component for every object in an array.',
    category: 'Loops',
    accent: '#73d7ff',
    concepts: ['One Repeat node', 'Typed current item'],
    syntax: ['props.items.map(...)'],
    createDocument: createArrayLoopLesson,
  },
  {
    id: 'nested-repeat',
    name: 'Nested Object + Array Loop',
    description: 'Loop through groups, then through the items array inside each group.',
    category: 'Loops',
    accent: '#4cc9f0',
    concepts: ['Object → groups[]', 'group.items[] → nested Repeat'],
    syntax: ['groups.map(...)', 'group.items.map(...)'],
    createDocument: createNestedLoopLesson,
  },
  {
    id: 'if-else',
    name: 'If / Else Branches',
    description: 'Switch between two complete component branches.',
    category: 'Conditions',
    accent: '#ffb86b',
    concepts: ['True component branch', 'False component branch'],
    syntax: ['condition ? trueBranch : falseBranch'],
    createDocument: createIfElseLesson,
  },
  {
    id: 'logical-and',
    name: 'Logical AND (&&)',
    description: 'Render a component only when both values are true.',
    category: 'Conditions',
    accent: '#46d8e8',
    concepts: ['Both values required', 'True branch only'],
    syntax: ['isSignedIn && hasNotifications'],
    createDocument: createLogicalAndLesson,
  },
  {
    id: 'logical-or',
    name: 'Logical OR (||)',
    description: 'Render a component when either value is true.',
    category: 'Conditions',
    accent: '#79e6aa',
    concepts: ['Either value grants access', 'False only when both are false'],
    syntax: ['isOwner || isAdmin'],
    createDocument: createLogicalOrLesson,
  },
  {
    id: 'logical-not',
    name: 'Logical NOT (!)',
    description: 'Invert a boolean before rendering a component.',
    category: 'Conditions',
    accent: '#ffd36b',
    concepts: ['Boolean inversion', 'Render when false becomes true'],
    syntax: ['!isLoading'],
    createDocument: createLogicalNotLesson,
  },
  {
    id: 'ternary',
    name: 'Ternary Value (? :)',
    description: 'Choose one of two values inside the same component.',
    category: 'Expressions',
    accent: '#c7a7ff',
    concepts: ['One component', 'Two possible prop values'],
    syntax: ['isPro ? "PRO PLAN" : "FREE PLAN"'],
    createDocument: createTernaryLesson,
  },
  {
    id: 'nullish-fallback',
    name: 'Default Fallback (??)',
    description: 'Generate a safe fallback for an optional prop with a typed default.',
    category: 'Expressions',
    accent: '#e6a8ff',
    concepts: ['Optional typed prop', 'Generated nullish fallback'],
    syntax: ['props.headline ?? "Default headline"'],
    createDocument: createNullishFallbackLesson,
  },
  {
    id: 'typed-event-argument',
    name: 'Typed Event Argument',
    description: 'Pass item.id from Repeat into a typed page event.',
    category: 'Events',
    accent: '#ff8f9c',
    concepts: ['itemId: string payload', 'No native mouse event forwarding'],
    syntax: ['props.onSelectItem?.(item.id)'],
    createDocument: createTypedEventLesson,
  },
] as const;

export function learningExampleById(exampleId: string): LearningExample | undefined {
  return studioLearningExamples.find((example) => example.id === exampleId);
}
