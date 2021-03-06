import assign from 'lodash.assign';
import compact from 'lodash.compact';
import find from 'lodash.find';
import isString from 'lodash.isstring';

const defaultOptions = {
	blockPrefix: '',
	elementPrefix: '__',
	modifierPrefix: '--'
};

let opts, t;

export default ({ options, types }) => {
	opts = assign({}, defaultOptions, options);
	t = types;

	return {
		visitor: {
			CallExpression(node) {
				if (t.isReturnStatement(node.parent)) {
					walkCallExpressions(null, node.node);
				}
			}
		}
	};
}

function walkCallExpressions(ancestorBlock, node) {
	/* istanbul ignore if */
	if (!isReactCreateElementExpression(node)) {
		return;
	}

	const [ type, props, ...children ] = node.arguments;

	if (!t.isObjectExpression(props)) {
		children.forEach(walkCallExpressions.bind(this, ancestorBlock));
		return;
	}

	if (t.isIdentifier(type)) {
		let { block, element } = getBlockAndElement(props);
		if (element && !block) {
			props.properties.unshift(new t.ObjectProperty(
				new t.Identifier('block'),
				new t.StringLiteral(ancestorBlock)
			));
		}
		children.forEach(walkCallExpressions.bind(this, block || ancestorBlock));
		return;
	}

	let { block, element, modifiers } = consumeBEMProperties(props);

	block = block || ancestorBlock;

	children.forEach(walkCallExpressions.bind(this, block));

	if (!validateBEMAttributes({ block, element, modifiers })) {
		return;
	}

	const { properties } = props;
	assignClassName({ properties, block, element, modifiers });
}

function isReactCreateElementExpression(node) {
	const { callee } = node;
	/* istanbul ignore if */
	if (!t.isMemberExpression(callee)) {
		return false;
	}
	/* istanbul ignore if */
	if (callee.object.name !== 'React') {
		return false;
	}
	/* istanbul ignore if */
	if (callee.property.name !== 'createElement') {
		return false;
	}
	return true;
}

function getBlockAndElement(obj) {
	let block, element, modifiers;
	obj.properties.forEach(({ key, value }, index) => {
		if (key.name === 'element') {
			element = resolveTokenValue(value);
			return;
		}
		/* istanbul ignore else */
		if (key.name === 'block') {
			block = resolveTokenValue(value);
			return;
		}
	});
	return { block, element, modifiers };
}

function consumeBEMProperties(obj) {
	let block, element, modifiers;
	obj.properties.forEach(({ key, value }, index) => {
		if (key.name === 'element') {
			element = consumeProperty({ value, index });
			return;
		}
		if (key.name === 'modifiers') {
			modifiers = consumeProperty({ value, index });
			return;
		}
		/* istanbul ignore else */
		if (key.name === 'block') {
			block = consumeProperty({ value, index });
			return;
		}
	});
	obj.properties = compact(obj.properties);
	return { block, element, modifiers };

	function consumeProperty({ value, index }) {
		delete obj.properties[index];
		return resolveTokenValue(value);
	}
}

function resolveTokenValue(token) {
	if (t.isStringLiteral(token) || t.isBooleanLiteral(token)) {
		return token.value;
	}
	if (t.isIdentifier(token)) {
		return `{${token.name}}`;
	}
	return token;
}

function validateBEMAttributes({ block, element, modifiers }) {
	if (block) {
		return true;
	}
	if (element) {
		throw new Error('BEM element must have an ancestor block');
	}
	if (modifiers) {
		throw new Error('BEM modifiers must be attached to a block or an element');
	}
	return false;
}

function assignClassName({ properties, block, element, modifiers }) {
	let prefix = `${opts.blockPrefix}${block}`;
	if (element) {
		prefix += `${opts.elementPrefix}${element}`;
	}
	const className = buildModifiers(prefix, modifiers);

	const classNameProp = find(properties, prop => prop.key.name === 'className');
	if (!classNameProp) {
		properties.push(buildClassName());
		return;
	}

	const { value } = classNameProp;

	if (t.isStringLiteral(value)) {
		value.value = `${className} ${value.value}`;
		return;
	}

	throw new Error('Unsupported className for BEM block or element');

	function buildClassName() {
		return new t.ObjectProperty(
			new t.Identifier('className'),
			isString(className)
				? new t.StringLiteral(className)
				: new t.CallExpression(
					new t.Identifier('classnames'),
					className
				)
		);
	}
}

function buildModifiers(prefix, modifiers) {
	if (!modifiers) {
		return prefix;
	}
	if (isString(modifiers)) {
		return [prefix].concat(modifiers.split(/\s+/g).map(
			modifier => `${prefix}${opts.modifierPrefix}${modifier}`
		)).join(' ');
	}
	if (t.isObjectExpression(modifiers)) {
		return [new t.StringLiteral(prefix)].concat(
			compact(modifiers.properties.map(({ key, value }) => {
				key = new t.StringLiteral(
					`${prefix}${opts.modifierPrefix}${key.name}`
				);
				if (t.isBooleanLiteral(value)) {
					if (value.value === false) {
						return false;
					}
					return key;
				}
				return new t.ObjectExpression([
					new t.ObjectProperty(key, value)
				]);
			}))
		);
	}
	throw new Error('Unsupported value for BEM modifiers');
}
